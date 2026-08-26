/**
 * +one marketing-site motion — GSAP runtime.
 *
 * Bundled by app/scripts/export-web.js (esbuild, iife, minified) into
 * /assets/js/site.js and loaded with `defer` from every marketing page.
 *
 * GSAP (core only — timelines for the hero + looping UI demos) plus a
 * ~20-line IntersectionObserver trigger for scroll reveals. That keeps the
 * whole runtime to a single small cached file: no React, no ScrollTrigger.
 *
 * Rules honoured here (landing-page performance guardrail):
 *   - transform / opacity only — no width/height/top/left tweens, ever
 *   - looping demos run ONLY while inside the viewport (paused otherwise)
 *   - prefers-reduced-motion: nothing animates (CSS keeps content visible)
 *   - no-JS: content is never hidden (reveal styles apply only under html.js)
 *   - the LCP image is never hidden — its entrance is transform-only
 */
import { gsap } from 'gsap';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* safety net: if anything below throws, unhide every reveal target    */
/* so content can never stay invisible because of a JS error.          */
/* ------------------------------------------------------------------ */
function revealAllNow() {
  document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
}
try {
  if (reduced) {
    revealAllNow();
  } else {
    initMotion();
  }
} catch (err) {
  revealAllNow();
  console.error('[site] motion init failed, showing all content:', err);
}

function initMotion() {
  heroEntrance();
  scrollReveals();
  chatDemo();
  pollDemo();
  feedDemo();
}

/* ------------------------------------------------------------------ */
/* tiny visibility trigger — the ScrollTrigger job, done in 15 lines   */
/* ------------------------------------------------------------------ */
function onVisible(el, start, end, onToggle) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) onToggle(entry.isIntersecting);
  }, { rootMargin: `${start} 0px ${end} 0px` });
  io.observe(el);
  return io;
}

/* ------------------------------------------------------------------ */
/* hero — staggered entrance; the phone floats on a slow, tiny loop    */
/* ------------------------------------------------------------------ */
function heroEntrance() {
  const copy = document.querySelector('.hero-copy');
  const frame = document.querySelector('.hero-shot .frame');
  const qr = document.querySelector('.qr-card');

  if (copy) {
    gsap.from(copy.children, {
      y: 18,
      autoAlpha: 0,
      duration: 0.55,
      ease: 'power2.out',
      stagger: 0.09,
      delay: 0.1,
      clearProps: 'transform,opacity,visibility',
    });
  }
  if (frame) {
    // transform-only settle; the image paints immediately (LCP-safe)
    gsap.from(frame, { y: 26, duration: 0.7, ease: 'power3.out', delay: 0.15, clearProps: 'transform' });
    gsap.to(frame, { y: -5, duration: 5.5, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1 });
  }
  if (qr) {
    gsap.from(qr, { scale: 0.9, autoAlpha: 0, duration: 0.5, ease: 'back.out(1.6)', delay: 0.5, clearProps: 'transform,opacity,visibility' });
  }
}

/* ------------------------------------------------------------------ */
/* scroll reveals — one-shot, per element; groups stagger              */
/* ------------------------------------------------------------------ */
function scrollReveals() {
  const els = gsap.utils.toArray('[data-reveal]');
  if (!els.length) return;

  const seen = new WeakSet();
  const io = new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;
      seen.add(entry.target);
      obs.unobserve(entry.target);

      const el = entry.target;
      const group = el.closest('[data-reveal-group]');
      const siblings = group
        ? Array.from(group.querySelectorAll('[data-reveal]'))
        : [el];
      const index = Math.max(0, siblings.indexOf(el));
      gsap.fromTo(
        el,
        { y: 22, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.55,
          ease: 'power2.out',
          delay: (index % 6) * 0.06,
          onComplete() {
            el.classList.add('is-in');
            gsap.set(el, { clearProps: 'transform' });
          },
        }
      );
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

  els.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ */
/* demo runner — a looping timeline that only plays while on screen    */
/* ------------------------------------------------------------------ */
function loopWhenVisible(trigger, build) {
  const tl = build();
  tl.pause(0);
  onVisible(trigger, '0px', '-2%', (visible) => { visible ? tl.play() : tl.pause(); });
  return tl;
}

/* ------------------------------------------------------------------ */
/* chat demo — typing → reply → send → ✓ ✓ read → disappearing timer   */
/* ------------------------------------------------------------------ */
function chatDemo() {
  const root = document.getElementById('chat-demo');
  if (!root) return;

  const typing = root.querySelector('.typing');
  const msg2 = root.querySelector('.msg2');
  const msg3 = root.querySelector('.msg3');
  const vanish = root.querySelector('.msg-vanish');
  const ticks = root.querySelector('.ticks');
  const tick2 = root.querySelector('.tick2');
  const hand = root.querySelector('.vanish-hand');
  const timerLabel = root.querySelector('.vanish-count');
  const field = root.querySelector('.demo-input .field');

  const setCount = (v) => { if (timerLabel) timerLabel.textContent = v; };

  const reset = () => {
    gsap.set([typing, msg2, msg3, vanish, tick2], { autoAlpha: 0 });
    gsap.set(msg2, { y: 8, scale: 0.97 });
    gsap.set(msg3, { y: 10, scale: 0.92 });
    gsap.set(vanish, { y: 10, scale: 0.92 });
    gsap.set(hand, { rotate: 0 });
    if (ticks) ticks.classList.remove('read');
    if (field) field.textContent = 'Type a message';
    setCount('5s');
  };
  reset();

  loopWhenVisible(root, () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4, defaults: { ease: 'power2.out' } });

    // reset for every loop pass
    tl.add(() => reset());

    // them typing…
    tl.to(typing, { autoAlpha: 1, duration: 0.25 }, 0.4)
      .to(typing, { autoAlpha: 0, duration: 0.2 }, 1.5);

    // their reply lands
    tl.to(msg2, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.7)' }, 1.7);

    // me typing, then sending
    tl.add(() => { if (field) field.textContent = 'on my way 🏃'; }, 2.3)
      .to(msg3, { autoAlpha: 1, y: 0, scale: 1, duration: 0.32, ease: 'back.out(1.6)' }, 2.8)
      .add(() => { if (field) field.textContent = 'Type a message'; }, 3.2);

    // ticks: sent ✓ → delivered ✓✓ → read (highlighter)
    tl.to(tick2, { autoAlpha: 1, duration: 0.2 }, 3.6)
      .add(() => ticks && ticks.classList.add('read'), 4.4);

    // disappearing message: timer counts down, then the note vanishes
    tl.to(vanish, { autoAlpha: 1, y: 0, scale: 1, duration: 0.32, ease: 'back.out(1.6)' }, 5.2)
      .to(hand, { rotate: 300, duration: 4, ease: 'none' }, 5.6)
      .add(() => setCount('4s'), 6.4)
      .add(() => setCount('3s'), 7.2)
      .add(() => setCount('2s'), 8.0)
      .add(() => setCount('1s'), 8.8)
      .to(vanish, { autoAlpha: 0, scale: 0.7, duration: 0.45, ease: 'back.in(1.4)' }, 9.9);

    return tl;
  });
}

/* ------------------------------------------------------------------ */
/* poll demo — bars fill (scaleX), vote lands, chip pops               */
/* ------------------------------------------------------------------ */
function pollDemo() {
  const root = document.getElementById('poll-demo');
  if (!root) return;

  const fills = root.querySelectorAll('.poll-fill');
  const pcts = root.querySelectorAll('.poll-pct');
  const votes = root.querySelector('.poll-votes');
  const voted = root.querySelector('.voted');
  const chip = root.querySelector('.tape-chip');

  const reset = () => {
    gsap.set(fills, { scaleX: 0 });
    gsap.set([voted, chip], { autoAlpha: 0 });
    gsap.set(chip, { rotate: -0.6, scale: 0.9 });
    pcts.forEach((p) => { p.textContent = '0%'; });
    if (votes) votes.textContent = '12 votes';
  };
  reset();

  loopWhenVisible(root, () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.8, defaults: { ease: 'power3.out' } });

    tl.add(() => reset());

    tl.to(fills[0], { scaleX: 0.38, duration: 0.7 }, 0.4)
      .to(fills[1], { scaleX: 0.62, duration: 0.8 }, 0.55)
      .add(() => { if (pcts[0]) pcts[0].textContent = '38%'; }, 0.75)
      .add(() => { if (pcts[1]) pcts[1].textContent = '62%'; }, 0.95)
      .add(() => { if (votes) votes.textContent = '13 votes'; }, 1.4)
      .to(voted, { autoAlpha: 1, duration: 0.25 }, 1.5)
      .to(chip, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, 1.7)
      .to(chip, { rotate: 1.2, duration: 0.14, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 2.1);

    return tl;
  });
}

/* ------------------------------------------------------------------ */
/* network feed demo — like pulse, follow flips, count ticks up        */
/* ------------------------------------------------------------------ */
function feedDemo() {
  const root = document.getElementById('feed-demo');
  if (!root) return;

  const heart = root.querySelector('.heart-ico');
  const likeCount = root.querySelector('.like-count');
  const follow = root.querySelector('.follow-btn');
  const chip = root.querySelector('.tape-chip');

  const reset = () => {
    if (follow) { follow.textContent = 'FOLLOW'; follow.classList.remove('on'); }
    if (likeCount) likeCount.textContent = '24';
  };
  reset();

  loopWhenVisible(root, () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2, defaults: { ease: 'power2.out' } });

    tl.add(() => reset());

    // double-tap like: heart pops (transform only), count +1
    tl.to(heart, { scale: 1.4, duration: 0.16, ease: 'back.out(2.5)' }, 0.6)
      .to(heart, { scale: 1, duration: 0.22, ease: 'power2.inOut' }, 0.78)
      .add(() => { if (likeCount) likeCount.textContent = '25'; }, 0.7);

    // follow → following (state settles, like IconSwap in the app)
    tl.to(follow, { scale: 0.94, duration: 0.1 }, 1.5)
      .add(() => {
        if (follow) { follow.textContent = 'FOLLOWING ✓'; follow.classList.add('on'); }
      }, 1.6)
      .to(follow, { scale: 1, duration: 0.25, ease: 'back.out(2)' }, 1.6);

    // tape chip settles with a tiny wiggle
    tl.to(chip, { rotate: 0.8, duration: 0.12, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 2.2)
      .to(chip, { rotate: -0.6, duration: 0.12 }, 2.7);

    return tl;
  });
}
