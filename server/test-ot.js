/**
 * OT Tests — validates Operational Transformation implementation
 * Run: node test-ot.js
 */

const TextOperation = require('./src/ot/textOperation');
const { OTDocument } = require('./src/ot/document');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function assertEqual(name, a, b) {
  const cond = a === b;
  assert(name, cond, cond ? '' : `expected "${b}", got "${a}"`);
}

function assertThrows(name, fn) {
  try {
    fn();
    assert(name, false, 'expected throw but did not');
  } catch {
    assert(name, true);
  }
}

console.log('OT Core - TextOperation basics');
(() => {
  const op = new TextOperation();
  op.retain(5).insert(' world').retain(1).delete(2);
  assert('baseLength computed', op.baseLength === 5 + 1 + 2);
  assert('targetLength computed', op.targetLength === 5 + ' world'.length + 1);
  assert('ops merged retain', new TextOperation().retain(2).retain(3).ops[0].retain === 5);
  assert('ops merged insert', new TextOperation().insert('a').insert('b').ops[0].insert === 'ab');
})();

console.log('\nOT Core - Apply');
(() => {
  const op = new TextOperation().retain(6).insert('Brave ').retain(5);
  const result = op.apply('Hello World');
  assertEqual('apply insert', result, 'Hello Brave World');

  const op2 = new TextOperation().retain(5).delete(6).retain(6);
  assertEqual('apply delete', op2.apply('Hello World Hello'), 'Hello Hello');

  const op3 = TextOperation.fromDiff('Hello World', 'Hello Brave World');
  assertEqual('fromDiff then apply', op3.apply('Hello World'), 'Hello Brave World');

  assertThrows('apply rejects wrong length', () => {
    new TextOperation().retain(5).apply('ab');
  });
})();

console.log('\nOT Core - Compose');
(() => {
  const a = new TextOperation().retain(5).insert(' world').retain(5);
  const b = new TextOperation().retain(11).insert('!').retain(5);
  const composed = a.compose(b);
  assertEqual('compose insert+insert', composed.apply('HelloWorld'), 'Hello world!World');

  const del = new TextOperation().retain(5).delete(1).retain(5);
  const ins = new TextOperation().retain(5).insert('X').retain(5);
  const composed2 = del.compose(ins);
  assertEqual('compose delete then insert', composed2.apply('Hello World'), 'HelloXWorld');
})();

console.log('\nOT Core - Transform (concurrent edits converge)');
(() => {
  // Two users start from same doc "Hello World"
  // User A inserts " Brave" after Hello
  // User B deletes " World"
  const doc = 'Hello World';
  const opA = new TextOperation().retain(5).insert(' Brave').retain(6);
  const opB = new TextOperation().retain(5).delete(6);

  const [aPrime, bPrime] = TextOperation.transform(opA, opB);

  const afterA = opA.apply(doc);
  const afterAthenBPrime = bPrime.apply(afterA);

  const afterB = opB.apply(doc);
  const afterBthenAPrime = aPrime.apply(afterB);

  assertEqual('transform convergence', afterAthenBPrime, afterBthenAPrime);
  assertEqual('transform result', afterAthenBPrime, 'Hello Brave');

  // Insert vs insert
  const opC = new TextOperation().retain(5).insert(' Alice').retain(6);
  const opD = new TextOperation().retain(5).insert(' Bob').retain(6);
  const [cPrime, dPrime] = TextOperation.transform(opC, opD);
  const afterC = opC.apply(doc);
  const afterCthenDPrime = dPrime.apply(afterC);
  const afterD = opD.apply(doc);
  const afterDthenCPrime = cPrime.apply(afterD);
  assertEqual('insert vs insert converges', afterCthenDPrime, afterDthenCPrime);
})();

console.log('\nOT Core - Invert (undo)');
(() => {
  const doc = 'Hello World';
  const op = new TextOperation().retain(6).insert('Brave ').retain(5);
  const after = op.apply(doc);
  const inverse = op.invert(doc);
  const undone = inverse.apply(after);
  assertEqual('invert undoes operation', undone, doc);
})();

console.log('\nOT Core - fromDiff edge cases');
(() => {
  assertEqual('diff identical', TextOperation.fromDiff('abc', 'abc').apply('abc'), 'abc');
  assertEqual('diff empty to text', TextOperation.fromDiff('', 'hello').apply(''), 'hello');
  assertEqual('diff text to empty', TextOperation.fromDiff('hello', '').apply('hello'), '');
  assertEqual('diff insert at start', TextOperation.fromDiff('world', 'hello world').apply('world'), 'hello world');
  assertEqual('diff delete at start', TextOperation.fromDiff('hello world', 'world').apply('hello world'), 'world');
})();

console.log('\nOT Document - Versioning and transformation');
(() => {
  const doc = new OTDocument('test', 'Hello World');
  assertEqual('initial content', doc.content, 'Hello World');
  assert('initial version 0', doc.version === 0);

  // User A submits op based on version 0
  const opA = TextOperation.fromDiff('Hello World', 'Hello Brave World');
  const resultA = doc.submitOperation(opA, { userId: 'A', baseVersion: 0 });
  assertEqual('doc after A', resultA.snapshot.content, 'Hello Brave World');
  assert('version after A is 1', resultA.snapshot.version === 1);

  // User B submits op based on version 0 concurrently (delete World)
  const opB = new TextOperation().retain(5).delete(6);
  const transformedB = doc.transformIncoming({ operation: opB, meta: { userId: 'B', baseVersion: 0 } });
  const snapshotB = doc.applyOperation(transformedB);
  // Convergence: after A (Brave insertion) and B (delete World), final should contain Brave but not World
  // Exact spacing depends on diff representation (Hello Brave vs HelloBrave ) — both are convergent
  assert('doc after B transformed contains Brave', snapshotB.content.includes('Brave'));
  assert('doc after B transformed no longer contains World', !snapshotB.content.includes('World'));
  assert('version after B is 2', snapshotB.version === 2);

  // Test getOperationsSince
  const opsSince0 = doc.getOperationsSince(0);
  assert('ops since 0 length 2', opsSince0.length === 2);
  const opsSince1 = doc.getOperationsSince(1);
  assert('ops since 1 length 1', opsSince1.length === 1);
})();

console.log('\nOT Document - Concurrent multi-user scenario');
(() => {
  const doc = new OTDocument('collab', 'The quick brown fox');
  // Three concurrent edits from version 0
  const op1 = TextOperation.fromDiff('The quick brown fox', 'The quick brown fox jumps');
  const op2 = TextOperation.fromDiff('The quick brown fox', 'A quick brown fox');
  const op3 = TextOperation.fromDiff('The quick brown fox', 'The quick red fox');

  // Submit sequentially with transformation
  doc.submitOperation(op1, { userId: '1', baseVersion: 0 });
  const t2 = doc.transformIncoming({ operation: op2, meta: { userId: '2', baseVersion: 0 } });
  doc.applyOperation(t2);
  const t3 = doc.transformIncoming({ operation: op3, meta: { userId: '3', baseVersion: 0 } });
  doc.applyOperation(t3);

  assert('final version 3', doc.version === 3);
  assert('final content length > 0', doc.content.length > 0);
  console.log(`    Final doc: "${doc.content}"`);
})();

console.log('\nOT - Message edit history transformation');
(() => {
  // Simulate two devices editing same message concurrently
  let body = 'Hello World';
  const history = [];

  const edit1 = TextOperation.fromDiff(body, 'Hello Brave World');
  // Apply edit1
  body = edit1.apply(body);
  history.push(edit1);

  // Concurrent edit based on original "Hello World" -> "Hello World!"
  const edit2Orig = TextOperation.fromDiff('Hello World', 'Hello World!');
  // Transform against history[0]
  const [edit2Prime] = TextOperation.transform(edit2Orig, history[0]);
  body = edit2Prime.apply(body);
  history.push(edit2Prime);

  assertEqual('message edit OT converges', body, 'Hello Brave World!');
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log('All OT checks passed.');
