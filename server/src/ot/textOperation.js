/**
 * Operational Transformation - Text Operation
 * 
 * Implements a classic OT type for collaborative text editing.
 * Based on the Jupiter / Google Wave OT approach with transformation
 * functions that satisfy TP1 and TP2 properties.
 * 
 * Operation format: array of components
 *   - { retain: n } : skip n characters
 *   - { insert: "text" } : insert text
 *   - { delete: n } : delete n characters (or string for explicit delete)
 * 
 * Example: "Hello World" -> "Hello Brave World"
 *   Operation: [ { retain: 6 }, { insert: "Brave " }, { retain: 5 } ]
 */

class TextOperation {
  constructor() {
    this.ops = [];
    this.baseLength = 0;
    this.targetLength = 0;
  }

  // Builder methods
  retain(n) {
    if (typeof n !== 'number' || n <= 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    const last = this.ops[this.ops.length - 1];
    if (last && typeof last.retain === 'number') {
      last.retain += n;
    } else {
      this.ops.push({ retain: n });
    }
    return this;
  }

  insert(str) {
    if (!str || typeof str !== 'string' || str.length === 0) return this;
    this.targetLength += str.length;
    const last = this.ops[this.ops.length - 1];
    if (last && typeof last.insert === 'string') {
      last.insert += str;
    } else if (last && typeof last.delete === 'number' || typeof last?.delete === 'string') {
      // Insert before delete for canonical form
      const secondLast = this.ops[this.ops.length - 2];
      if (secondLast && typeof secondLast.insert === 'string') {
        secondLast.insert += str;
      } else {
        this.ops.splice(this.ops.length - 1, 0, { insert: str });
      }
    } else {
      this.ops.push({ insert: str });
    }
    return this;
  }

  delete(n) {
    if (n === 0 || n === '' || n == null) return this;
    let count = 0;
    if (typeof n === 'number') {
      if (n <= 0) return this;
      count = n;
    } else if (typeof n === 'string') {
      if (n.length === 0) return this;
      count = n.length;
      // Store string delete for undo purposes, but treat as count for length
      // We'll keep string form for clarity
      this.baseLength += count;
      const last = this.ops[this.ops.length - 1];
      if (last && typeof last.delete === 'string') {
        last.delete += n;
      } else if (last && typeof last.delete === 'number') {
        // Convert to string if mixing? Keep numeric for simplicity
        last.delete += count;
      } else {
        this.ops.push({ delete: n });
      }
      return this;
    }
    this.baseLength += count;
    const last = this.ops[this.ops.length - 1];
    if (last && typeof last.delete === 'number') {
      last.delete += count;
    } else if (last && typeof last.delete === 'string') {
      // If last is string delete, convert to numeric tracking
      const lastLen = last.delete.length;
      last.delete = lastLen + count;
    } else {
      this.ops.push({ delete: count });
    }
    return this;
  }

  // Check if operation does nothing
  isNoop() {
    return this.ops.length === 0 || (this.ops.length === 1 && typeof this.ops[0].retain === 'number' && this.ops[0].retain === this.baseLength);
  }

  // Clone
  clone() {
    const op = new TextOperation();
    op.ops = JSON.parse(JSON.stringify(this.ops));
    op.baseLength = this.baseLength;
    op.targetLength = this.targetLength;
    return op;
  }

  // Equality check
  equals(other) {
    if (this.baseLength !== other.baseLength) return false;
    if (this.targetLength !== other.targetLength) return false;
    if (this.ops.length !== other.ops.length) return false;
    for (let i = 0; i < this.ops.length; i++) {
      const a = this.ops[i];
      const b = other.ops[i];
      if (a.retain !== b.retain) return false;
      if (a.insert !== b.insert) return false;
      if (a.delete !== b.delete) {
        // Allow numeric vs string delete comparison if same length
        const aDel = typeof a.delete === 'string' ? a.delete.length : a.delete;
        const bDel = typeof b.delete === 'string' ? b.delete.length : b.delete;
        if (aDel !== bDel) return false;
      }
    }
    return true;
  }

  // Apply operation to a string
  apply(str) {
    if (str.length !== this.baseLength) {
      throw new Error(`Operation baseLength ${this.baseLength} does not match document length ${str.length}`);
    }
    const result = [];
    let index = 0;
    for (const op of this.ops) {
      if (typeof op.retain === 'number') {
        if (index + op.retain > str.length) {
          throw new Error('Retain beyond document length');
        }
        result.push(str.slice(index, index + op.retain));
        index += op.retain;
      } else if (typeof op.insert === 'string') {
        result.push(op.insert);
      } else if (op.delete != null) {
        const delLen = typeof op.delete === 'string' ? op.delete.length : op.delete;
        index += delLen;
      }
    }
    if (index !== str.length) {
      throw new Error(`Operation did not operate on whole document: ${index} vs ${str.length}`);
    }
    return result.join('');
  }

  // Invert operation against original document to get undo operation
  invert(str) {
    const inverse = new TextOperation();
    let index = 0;
    for (const op of this.ops) {
      if (typeof op.retain === 'number') {
        inverse.retain(op.retain);
        index += op.retain;
      } else if (typeof op.insert === 'string') {
        inverse.delete(op.insert.length);
      } else if (op.delete != null) {
        const delLen = typeof op.delete === 'string' ? op.delete.length : op.delete;
        const deletedText = typeof op.delete === 'string' ? op.delete : str.slice(index, index + delLen);
        inverse.insert(deletedText);
        index += delLen;
      }
    }
    return inverse;
  }

  // Compose two operations: this * other = this followed by other
  compose(other) {
    if (this.targetLength !== other.baseLength) {
      throw new Error(`Cannot compose: first targetLength ${this.targetLength} != second baseLength ${other.baseLength}`);
    }
    const result = new TextOperation();
    const a = this.clone();
    const b = other.clone();
    let i1 = 0, i2 = 0;
    let op1 = a.ops[i1++] || null;
    let op2 = b.ops[i2++] || null;

    const next1 = () => { op1 = a.ops[i1++] || null; };
    const next2 = () => { op2 = b.ops[i2++] || null; };

    while (op1 || op2) {
      if (op1 && typeof op1.delete === 'number' || typeof op1?.delete === 'string') {
        // Delete from first operation is always kept
        const delLen = typeof op1.delete === 'string' ? op1.delete.length : op1.delete;
        result.delete(delLen);
        next1();
        continue;
      }
      if (op2 && typeof op2.insert === 'string') {
        result.insert(op2.insert);
        next2();
        continue;
      }

      if (!op1) throw new Error('Cannot compose: first operation too short');
      if (!op2) throw new Error('Cannot compose: first operation too long');

      // Both have retain or one has retain and other has delete
      if (typeof op1.retain === 'number' && typeof op2.retain === 'number') {
        const min = Math.min(op1.retain, op2.retain);
        result.retain(min);
        op1.retain -= min;
        op2.retain -= min;
        if (op1.retain === 0) next1();
        if (op2.retain === 0) next2();
      } else if (typeof op1.retain === 'number' && op2.delete != null) {
        const delLen = typeof op2.delete === 'string' ? op2.delete.length : op2.delete;
        const min = Math.min(op1.retain, delLen);
        result.delete(min);
        op1.retain -= min;
        if (typeof op2.delete === 'number') {
          op2.delete -= min;
        } else {
          op2.delete = op2.delete.slice(min);
        }
        if (op1.retain === 0) next1();
        if ((typeof op2.delete === 'number' && op2.delete === 0) || (typeof op2.delete === 'string' && op2.delete.length === 0)) next2();
      } else if (typeof op1.insert === 'string' && typeof op2.retain === 'number') {
        const insLen = op1.insert.length;
        const min = Math.min(insLen, op2.retain);
        if (min === insLen) {
          result.insert(op1.insert);
          next1();
          op2.retain -= min;
          if (op2.retain === 0) next2();
        } else {
          result.insert(op1.insert.slice(0, min));
          op1.insert = op1.insert.slice(min);
          op2.retain -= min;
          if (op2.retain === 0) next2();
        }
      } else if (typeof op1.insert === 'string' && op2.delete != null) {
        const insLen = op1.insert.length;
        const delLen = typeof op2.delete === 'string' ? op2.delete.length : op2.delete;
        const min = Math.min(insLen, delLen);
        // Inserted text is deleted, so neither appears in result
        if (min < insLen) {
          op1.insert = op1.insert.slice(min);
        } else {
          next1();
        }
        if (typeof op2.delete === 'number') {
          op2.delete -= min;
        } else {
          op2.delete = op2.delete.slice(min);
        }
        if ((typeof op2.delete === 'number' && op2.delete === 0) || (typeof op2.delete === 'string' && op2.delete.length === 0)) next2();
      } else {
        throw new Error(`Cannot compose operations: ${JSON.stringify(op1)} and ${JSON.stringify(op2)}`);
      }
    }
    return result;
  }

  // Transform two concurrent operations: returns [a', b'] where a' = a transformed against b
  static transform(a, b) {
    if (a.baseLength !== b.baseLength) {
      throw new Error(`Cannot transform: base lengths differ ${a.baseLength} vs ${b.baseLength}`);
    }
    const aPrime = new TextOperation();
    const bPrime = new TextOperation();
    const aOps = a.clone().ops;
    const bOps = b.clone().ops;
    let i1 = 0, i2 = 0;
    let op1 = aOps[i1++] || null;
    let op2 = bOps[i2++] || null;

    const next1 = () => { op1 = aOps[i1++] || null; };
    const next2 = () => { op2 = bOps[i2++] || null; };

    while (op1 || op2) {
      // Insert has priority: insert operations are always before retain/delete of other
      if (op1 && typeof op1.insert === 'string') {
        aPrime.insert(op1.insert);
        bPrime.retain(op1.insert.length);
        next1();
        continue;
      }
      if (op2 && typeof op2.insert === 'string') {
        aPrime.retain(op2.insert.length);
        bPrime.insert(op2.insert);
        next2();
        continue;
      }

      if (!op1) throw new Error('Cannot transform: first operation too short');
      if (!op2) throw new Error('Cannot transform: first operation too long');

      // Both retain
      if (typeof op1.retain === 'number' && typeof op2.retain === 'number') {
        const min = Math.min(op1.retain, op2.retain);
        aPrime.retain(min);
        bPrime.retain(min);
        op1.retain -= min;
        op2.retain -= min;
        if (op1.retain === 0) next1();
        if (op2.retain === 0) next2();
      }
      // Both delete - both delete same chars, so both become noop for that region
      else if (op1.delete != null && op2.delete != null) {
        const del1Len = typeof op1.delete === 'string' ? op1.delete.length : op1.delete;
        const del2Len = typeof op2.delete === 'string' ? op2.delete.length : op2.delete;
        const min = Math.min(del1Len, del2Len);
        // Both delete, so nothing to do in transformed ops
        if (typeof op1.delete === 'number') op1.delete -= min; else op1.delete = op1.delete.slice(min);
        if (typeof op2.delete === 'number') op2.delete -= min; else op2.delete = op2.delete.slice(min);
        if ((typeof op1.delete === 'number' && op1.delete === 0) || (typeof op1.delete === 'string' && op1.delete.length === 0)) next1();
        if ((typeof op2.delete === 'number' && op2.delete === 0) || (typeof op2.delete === 'string' && op2.delete.length === 0)) next2();
      }
      // op1 delete, op2 retain
      else if (op1.delete != null && typeof op2.retain === 'number') {
        const delLen = typeof op1.delete === 'string' ? op1.delete.length : op1.delete;
        const min = Math.min(delLen, op2.retain);
        aPrime.delete(min);
        // bPrime does nothing for deleted region
        if (typeof op1.delete === 'number') op1.delete -= min; else op1.delete = op1.delete.slice(min);
        op2.retain -= min;
        if ((typeof op1.delete === 'number' && op1.delete === 0) || (typeof op1.delete === 'string' && op1.delete.length === 0)) next1();
        if (op2.retain === 0) next2();
      }
      // op1 retain, op2 delete
      else if (typeof op1.retain === 'number' && op2.delete != null) {
        const delLen = typeof op2.delete === 'string' ? op2.delete.length : op2.delete;
        const min = Math.min(op1.retain, delLen);
        // aPrime does nothing for region deleted by b
        bPrime.delete(min);
        op1.retain -= min;
        if (typeof op2.delete === 'number') op2.delete -= min; else op2.delete = op2.delete.slice(min);
        if (op1.retain === 0) next1();
        if ((typeof op2.delete === 'number' && op2.delete === 0) || (typeof op2.delete === 'string' && op2.delete.length === 0)) next2();
      }
      else {
        throw new Error(`Cannot transform operations: ${JSON.stringify(op1)} and ${JSON.stringify(op2)}`);
      }
    }
    return [aPrime, bPrime];
  }

  // Transform cursor position against an operation
  static transformCursor(cursor, operation) {
    let index = 0;
    let newIndex = cursor;
    for (const op of operation.ops) {
      if (typeof op.retain === 'number') {
        index += op.retain;
      } else if (typeof op.insert === 'string') {
        if (index < cursor || (index === cursor && operation.insertionIsBeforeCursor !== false)) {
          newIndex += op.insert.length;
        }
      } else if (op.delete != null) {
        const delLen = typeof op.delete === 'string' ? op.delete.length : op.delete;
        if (index < cursor) {
          newIndex -= Math.min(delLen, cursor - index);
        }
        index += delLen;
      }
    }
    return newIndex;
  }

  // Create operation from old text and new text (diff)
  static fromDiff(oldStr, newStr) {
    const op = new TextOperation();
    // Simple diff algorithm: find common prefix and suffix
    let start = 0;
    while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) {
      start++;
    }
    if (start > 0) op.retain(start);

    let endOld = oldStr.length;
    let endNew = newStr.length;
    while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) {
      endOld--;
      endNew--;
    }

    const deleted = endOld - start;
    const inserted = newStr.slice(start, endNew);

    if (deleted > 0) op.delete(deleted);
    if (inserted.length > 0) op.insert(inserted);

    const suffixRetain = oldStr.length - endOld;
    if (suffixRetain > 0) op.retain(suffixRetain);

    // Edge case: if strings equal, operation should retain whole
    if (op.ops.length === 0) {
      op.retain(oldStr.length);
    }

    return op;
  }

  // Serialization
  toJSON() {
    return this.ops;
  }

  static fromJSON(ops) {
    const op = new TextOperation();
    if (!Array.isArray(ops)) throw new Error('Invalid operation JSON');
    for (const component of ops) {
      if (typeof component.retain === 'number') op.retain(component.retain);
      else if (typeof component.insert === 'string') op.insert(component.insert);
      else if (component.delete != null) {
        if (typeof component.delete === 'number') op.delete(component.delete);
        else if (typeof component.delete === 'string') op.delete(component.delete);
        else throw new Error('Invalid delete component');
      } else {
        throw new Error(`Invalid operation component: ${JSON.stringify(component)}`);
      }
    }
    return op;
  }

  // For debugging
  toString() {
    return this.ops.map(op => {
      if (op.retain) return `retain(${op.retain})`;
      if (op.insert) return `insert('${op.insert}')`;
      if (op.delete) return `delete(${typeof op.delete === 'string' ? `'${op.delete}'` : op.delete})`;
      return 'unknown';
    }).join(', ');
  }
}

module.exports = TextOperation;
