#!/usr/bin/env bash
#
# provision.sh — one-shot AWS EC2 provisioning for the +one backend.
#
# Designed to run in the AWS Console's CloudShell (browser terminal, zero
# install, already authenticated) or on any machine with the AWS CLI
# configured. Everything it creates is tagged so it can be found and torn
# down later.
#
# What it creates (all in ap-south-1 / Mumbai by default):
#   - Security group  plusone-sg        (22 from ADMIN_CIDR, 80+443 from world)
#   - SSH key pair    plusone-key       (private key saved to ~/.ssh/plusone-key.pem)
#   - EC2 instance    plusone-server    (t4g.small, Ubuntu 24.04 ARM64)
#   - EBS volume      plusone-data      (20 GB gp3, mounted at /data on the box —
#                                        SQLite db, uploads, backups and VAPID keys
#                                        live here and survive rebuilds/reboots)
#   - Elastic IP      plusone-ip        (stable public address for the domain)
#
# Bootstrap (user data) installs Docker, mounts the volume, clones this repo
# and starts the backend with docker compose. TLS is NOT set up here — run
# scripts/aws/setup-domain.sh after you have a Route53 domain.
#
# Usage:
#   bash scripts/aws/provision.sh
#
# Optional env overrides:
#   AWS_REGION=ap-south-1 INSTANCE_TYPE=t4g.small VOLUME_SIZE=20 \
#   ADMIN_CIDR=0.0.0.0/0 REPO=https://github.com/sakshamfit/BROSKIE.git BRANCH=main \
#   bash scripts/aws/provision.sh
#
set -euo pipefail

PROJECT="plusone"
REGION="${AWS_REGION:-ap-south-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
VOLUME_SIZE="${VOLUME_SIZE:-20}"
ADMIN_CIDR="${ADMIN_CIDR:-0.0.0.0/0}"
REPO="${REPO:-https://github.com/sakshamfit/BROSKIE.git}"
BRANCH="${BRANCH:-main}"
KEY_NAME="${KEY_NAME:-${PROJECT}-key}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/${KEY_NAME}.pem}"

export AWS_DEFAULT_REGION="$REGION"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- prerequisites
command -v aws >/dev/null || die "aws CLI not found. Run this inside AWS CloudShell (https://${REGION}.console.aws.amazon.com/cloudshell) or install the CLI."
aws sts get-caller-identity >/dev/null 2>&1 || die "aws CLI is not authenticated."
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
say "Authenticated to AWS account ${ACCOUNT}, region ${REGION}"

case "$INSTANCE_TYPE" in
  t4g.*|a1.*|m6g.*|m7g.*|m8g.*|c6g.*|c7g.*|c8g.*|r6g.*|r7g.*|r8g.*) ARCH="arm64" ;;
  *) ARCH="amd64" ;;
esac

# ---------------------------------------------------------------- security group
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${PROJECT}-sg" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name "${PROJECT}-sg" \
    --description "${PROJECT}: ssh(22 admin), http(80), https(443)" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT}-sg},{Key=Project,Value=${PROJECT}}]" \
    --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${ADMIN_CIDR},Description='SSH admin'}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description='HTTP (ACME + redirect)'}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description='HTTPS app + WSS'}]"
  say "Created security group ${SG_ID} (ssh from ${ADMIN_CIDR}, 80/443 open)"
else
  say "Using existing security group ${SG_ID}"
fi
[ "$ADMIN_CIDR" = "0.0.0.0/0" ] && printf '\033[1;33mNOTE:\033[0m SSH (22) is open to the world. Restrict later with: aws ec2 revoke-security-group-ingress + authorize your IP. Fine for a personal app; tighten it when you can.\n'

# ---------------------------------------------------------------- SSH key pair
mkdir -p "$HOME/.ssh"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  say "Key pair ${KEY_NAME} already exists in AWS"
  [ -f "$KEY_FILE" ] || say "WARNING: ${KEY_FILE} not found locally — you created this key earlier. Delete the AWS key pair and re-run, or set KEY_NAME to a new name."
else
  aws ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text > "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  say "Created key pair ${KEY_NAME}, private key saved to ${KEY_FILE} (guarded 0400, never commit it)"
fi

# ---------------------------------------------------------------- AMI (Ubuntu 24.04 LTS)
AMI=$(aws ec2 describe-images --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${ARCH}-server-*" \
            "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
[ -n "$AMI" ] && [ "$AMI" != "None" ] || die "Could not resolve an Ubuntu 24.04 ${ARCH} AMI"
say "AMI: ${AMI} (Ubuntu 24.04 ${ARCH})"

# ---------------------------------------------------------------- EC2 instance
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${PROJECT}-server" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  USER_DATA=$(mktemp)
  # Inject the repo settings as exported vars before the bootstrap body; the
  # body's ${REPO_URL:-…} defaults then pick them up. (envsubst would have
  # mangled the script's own bash expansions, so do a literal header instead.)
  { printf '#!/usr/bin/env bash\nexport REPO_URL=%q REPO_BRANCH=%q\n' "$REPO" "$BRANCH"
    tail -n +2 "$(dirname "$0")/user-data.sh"; } > "$USER_DATA"
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
    --user-data "file://${USER_DATA}" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=15,VolumeType=gp3,DeleteOnTermination=true}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PROJECT}-server},{Key=Project,Value=${PROJECT}}]" \
    --query 'Instances[0].InstanceId' --output text)
  rm -f "$USER_DATA"
  say "Launched instance ${INSTANCE_ID} (${INSTANCE_TYPE}) — waiting for it to run..."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
else
  say "Using existing instance ${INSTANCE_ID}"
  STATE=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
  [ "$STATE" = "running" ] || { aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null; aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"; }
fi
AZ=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text)
say "Instance running in ${AZ}"

# ---------------------------------------------------------------- EBS data volume
VOLUME_ID=$(aws ec2 describe-volumes \
  --filters "Name=tag:Name,Values=${PROJECT}-data" "Name=status,Values=available,in-use" \
  --query 'Volumes[0].VolumeId' --output text 2>/dev/null || true)
if [ -z "$VOLUME_ID" ] || [ "$VOLUME_ID" = "None" ]; then
  VOLUME_ID=$(aws ec2 create-volume --availability-zone "$AZ" --size "$VOLUME_SIZE" --volume-type gp3 \
    --tag-specifications "ResourceType=volume,Tags=[{Key=Name,Value=${PROJECT}-data},{Key=Project,Value=${PROJECT}}]" \
    --query VolumeId --output text)
  aws ec2 wait volume-available --volume-ids "$VOLUME_ID"
  say "Created data volume ${VOLUME_ID} (${VOLUME_SIZE} GB gp3 in ${AZ})"
else
  say "Using existing data volume ${VOLUME_ID}"
fi
ATTACHED=$(aws ec2 describe-volumes --volume-ids "$VOLUME_ID" \
  --query 'length(Attachments[?InstanceId==`'"$INSTANCE_ID"'`])' --output text)
if [ "$ATTACHED" = "0" ]; then
  aws ec2 attach-volume --volume-id "$VOLUME_ID" --instance-id "$INSTANCE_ID" --device /dev/sdf >/dev/null
  say "Attached ${VOLUME_ID} to ${INSTANCE_ID} as /dev/sdf (shows as /dev/nvme1n1 on the box)"
fi

# ---------------------------------------------------------------- Elastic IP
ALLOC_ID=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${PROJECT}-ip" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)
if [ -z "$ALLOC_ID" ] || [ "$ALLOC_ID" = "None" ]; then
  ALLOC_ID=$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT}-ip},{Key=Project,Value=${PROJECT}}]" \
    --query AllocationId --output text)
  say "Allocated Elastic IP ${ALLOC_ID}"
fi
PUBLIC_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)
CURRENT_ASSOC=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].InstanceId' --output text)
if [ "$CURRENT_ASSOC" != "$INSTANCE_ID" ]; then
  aws ec2 associate-address --allocation-id "$ALLOC_ID" --instance-id "$INSTANCE_ID" >/dev/null
  say "Associated ${PUBLIC_IP} with ${INSTANCE_ID}"
fi

# ---------------------------------------------------------------- summary
cat <<EOF

$(printf '\033[1;32m')──────────────────────────────────────────────────────────$(printf '\033[0m')
 AWS provisioning done

   Instance : ${INSTANCE_ID}  (${INSTANCE_TYPE}, ${AZ})
   Volume   : ${VOLUME_ID}  (${VOLUME_SIZE} GB, mounted at /data on the box)
   Public IP: ${PUBLIC_IP}  (Elastic IP — stable across reboots)
   SSH key  : ${KEY_FILE}

 First boot takes ~8-10 minutes (Docker build compiles the app).
 Watch it live:   ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP} 'tail -f /var/log/plusone-bootstrap.log'
 Health check:    ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP} 'curl -s localhost:4000/health'

 Next steps:
   1. Buy your domain in Route53 (console → Route 53 → Register domain)
   2. Run:  bash scripts/aws/setup-domain.sh YOURDOMAIN.COM
   3. Migrate your Railway data:  bash scripts/aws/migrate-data.sh

 Full walkthrough: AWS_DEPLOY.md
$(printf '\033[1;32m')──────────────────────────────────────────────────────────$(printf '\033[0m')
EOF
