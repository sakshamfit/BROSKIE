/* End-to-end test for Forgot Password & OTP verification flow.
 * Usage: node test-forgot-password-otp.js */
process.env.PORT = '4400';
process.env.DATA_DIR = `/tmp/plusone-otp-test-${Date.now()}`;

require('./src/index');

const API = 'http://localhost:4400';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const stamp = Date.now();
  const username = `alice_${stamp}`;
  const phone = `+91${stamp}`;
  const password = 'OldPass!123';
  const newPassword = 'NewPass!456';

  console.log('\n--- STARTING FORGOT PASSWORD & OTP TEST ---');

  // 1. Register a test user
  let userRecord;
  try {
    userRecord = await req('/api/auth/register', {
      method: 'POST',
      body: { username, phone, name: 'Alice Test', password },
    });
    ok('user registered successfully', !!userRecord.token);
  } catch (e) {
    ok('user registration failed', false, e.message);
  }

  // 2. Request OTP with unregistered phone
  try {
    await req('/api/auth/forgot-password', {
      method: 'POST',
      body: { phone: '+910000000000' },
    });
    ok('unregistered phone allowed OTP request (unexpected)', false);
  } catch (e) {
    ok('unregistered phone correctly rejected', e.status === 404 && e.message.includes('No account registered'));
  }

  // 3. Request OTP with empty phone
  try {
    await req('/api/auth/forgot-password', {
      method: 'POST',
      body: { phone: '' },
    });
    ok('empty phone allowed OTP request (unexpected)', false);
  } catch (e) {
    ok('empty phone correctly rejected', e.status === 400 && e.message.includes('Phone number is required'));
  }

  // 4. Request OTP successfully
  let otpCode = null;
  // Capture console.log to get the generated OTP from server logs
  const originalLog = console.log;
  console.log = function (...args) {
    originalLog.apply(console, args);
    const logStr = args.join(' ');
    if (logStr.includes('[OTP] Sent OTP')) {
      const match = logStr.match(/Sent OTP (\d+)/);
      if (match) otpCode = match[1];
    }
  };

  try {
    const res = await req('/api/auth/forgot-password', {
      method: 'POST',
      body: { phone },
    });
    ok('OTP request succeeded', res.success === true);
    ok('OTP code successfully captured from server logs', !!otpCode);
  } catch (e) {
    ok('OTP request failed', false, e.message);
  }
  
  // Restore original log
  console.log = originalLog;

  // 5. Verify OTP with incorrect code
  try {
    await req('/api/auth/verify-otp', {
      method: 'POST',
      body: { phone, otp: '111111' },
    });
    ok('invalid OTP verified successfully (unexpected)', false);
  } catch (e) {
    ok('invalid OTP correctly rejected', e.status === 400 && e.message.includes('Invalid OTP'));
  }

  // 6. Verify OTP rate-limiting / multi-attempts lock
  // Attempt 2
  try { await req('/api/auth/verify-otp', { method: 'POST', body: { phone, otp: '111111' } }); } catch (e) {}
  // Attempt 3 -> Should lock / delete
  try {
    await req('/api/auth/verify-otp', { method: 'POST', body: { phone, otp: '111111' } });
    ok('third failed attempt not rate limited (unexpected)', false);
  } catch (e) {
    ok('rate limiting active: locked out after 3 attempts', e.status === 400 && e.message.includes('Too many incorrect attempts'));
  }

  // 7. Re-request OTP after lock out
  let newOtpCode = null;
  console.log = function (...args) {
    originalLog.apply(console, args);
    const logStr = args.join(' ');
    if (logStr.includes('[OTP] Sent OTP')) {
      const match = logStr.match(/Sent OTP (\d+)/);
      if (match) newOtpCode = match[1];
    }
  };

  try {
    await req('/api/auth/forgot-password', { method: 'POST', body: { phone } });
    ok('new OTP requested after lockout', !!newOtpCode);
  } catch (e) {
    ok('failed to request new OTP after lockout', false, e.message);
  }
  console.log = originalLog;

  // 8. Verify OTP successfully and retrieve secure single-use reset token
  let resetToken = null;
  try {
    const res = await req('/api/auth/verify-otp', {
      method: 'POST',
      body: { phone, otp: newOtpCode },
    });
    resetToken = res.resetToken;
    ok('valid OTP verified successfully', res.success === true);
    ok('secure single-use reset token received', !!resetToken);
  } catch (e) {
    ok('valid OTP verification failed', false, e.message);
  }

  // 9. Reset password with short password
  try {
    await req('/api/auth/reset-password', {
      method: 'POST',
      body: { resetToken, newPassword: '123' },
    });
    ok('short password accepted during reset (unexpected)', false);
  } catch (e) {
    ok('short password correctly validation rejected', e.status === 400 && e.message.includes('at least 8 characters'));
  }

  // 10. Reset password successfully
  try {
    const res = await req('/api/auth/reset-password', {
      method: 'POST',
      body: { resetToken, newPassword },
    });
    ok('password reset succeeded', res.success === true);
  } catch (e) {
    ok('password reset failed', false, e.message);
  }

  // 11. Reset token is single-use: try using it again
  try {
    await req('/api/auth/reset-password', {
      method: 'POST',
      body: { resetToken, newPassword },
    });
    ok('re-using consumed reset token allowed (unexpected)', false);
  } catch (e) {
    ok('reset token correctly marked single-use & blocked on re-use', e.status === 400 && e.message.includes('Invalid or expired'));
  }

  // 12. Try logging in with the old password (should be blocked)
  try {
    await req('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    ok('login with old password succeeded (unexpected)', false);
  } catch (e) {
    ok('login with old password correctly rejected', e.status === 401 && e.message.includes('Invalid username or password'));
  }

  // 13. Try logging in with the new password (should succeed!)
  try {
    const res = await req('/api/auth/login', {
      method: 'POST',
      body: { username, password: newPassword },
    });
    ok('login with new password succeeded!', !!res.token && res.user.username === username);
  } catch (e) {
    ok('login with new password failed', false, e.message);
  }

  console.log(`\n=== TEST SUMMARY: ${pass} PASSED, ${fail} FAILED ===\n`);
  process.exit(fail > 0 ? 1 : 0);
})();