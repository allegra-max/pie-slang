// src/lib_runner.ts
import * as fs from "fs";
import * as path from "path";

// src/scheme_parser/core-math.ts
var Match = class {
  constructor(result) {
    this.result = result;
  }
};
var IntegerMatch = class extends Match {
  constructor(result, value) {
    super(result);
    this.result = result;
    this.value = value;
  }
  isSigned() {
    return this.result ? this.value[0] === "+" || this.value[0] === "-" : false;
  }
  build() {
    return SchemeInteger.build(this.value);
  }
};
var RationalMatch = class extends Match {
  constructor(result, numerator, denominator) {
    super(result);
    this.result = result;
    this.numerator = numerator;
    this.denominator = denominator;
  }
  build() {
    return SchemeRational.build(this.numerator, this.denominator);
  }
};
var RealMatch = class extends Match {
  constructor(result, integer, decimal, exponent) {
    super(result);
    this.result = result;
    this.integer = integer;
    this.decimal = decimal;
    this.exponent = exponent;
  }
  build() {
    if (this.integer?.includes("inf")) {
      return this.integer.includes("-") ? SchemeReal.NEG_INFINITY : SchemeReal.INFINITY;
    }
    if (this.integer?.includes("nan")) {
      return SchemeReal.NAN;
    }
    const exponent = (this.exponent ? this.exponent.build() : SchemeReal.INEXACT_ZERO).coerce();
    let value = Number(
      (this.integer ? this.integer : "0") + "." + (this.decimal ? this.decimal : "0")
    );
    value *= Math.pow(10, exponent);
    return SchemeReal.build(value);
  }
};
var ComplexMatch = class extends Match {
  constructor(result, real, sign, imaginary) {
    super(result);
    this.result = result;
    this.real = real;
    this.sign = sign;
    this.imaginary = imaginary;
  }
  build() {
    const real = this.real ? this.real.build() : SchemeInteger.EXACT_ZERO;
    const imaginary = this.imaginary.build();
    if (this.sign && this.sign === "-") {
      return SchemeComplex.build(real, imaginary.negate());
    }
    return SchemeComplex.build(real, imaginary);
  }
};
function isInteger(value) {
  const integerRegex = new RegExp(`^([+-]?)(\\d+)$`);
  const match = integerRegex.exec(value);
  if (match) {
    return new IntegerMatch(true, match[0]);
  }
  return new IntegerMatch(false);
}
function isRational(value) {
  const count = (value.match(/\//g) || []).length;
  if (count !== 1) {
    return new RationalMatch(false);
  }
  const parts = value.split("/");
  if (parts.length !== 2) {
    return new RationalMatch(false);
  }
  const [numerator, denominator] = parts;
  const numeratorMatch = isInteger(numerator);
  const denominatorMatch = isInteger(denominator);
  if (!(numeratorMatch.result && denominatorMatch.result)) {
    return new RationalMatch(false);
  }
  return new RationalMatch(true, numerator, denominator);
}
function isReal(value) {
  function checkBasicReal(value2) {
    function isSpecialNumber(value3) {
      return value3 === "+inf.0" || value3 === "-inf.0" || value3 === "+nan.0" || value3 === "-nan.0";
    }
    if (isSpecialNumber(value2)) {
      return new RealMatch(true, value2);
    }
    const count2 = (value2.match(/\./g) || []).length;
    if (count2 > 1) {
      return new RealMatch(false);
    }
    if (count2 === 0) {
      const result = isInteger(value2);
      return new RealMatch(result.result, result.value);
    }
    const [integerPart, decimalPart] = value2.split(".");
    const integerMatch = isInteger(integerPart);
    const decimalMatch = isInteger(decimalPart);
    const properInteger = integerMatch.result || integerPart === "";
    const properDecimal = decimalMatch.result || decimalPart === "";
    if (integerPart === "+" || integerPart === "-") {
      if (decimalPart === "") {
        return new RealMatch(false);
      }
      return new RealMatch(true, `${integerPart}0`, value2);
    }
    if (!(integerMatch.result && properDecimal || properInteger && decimalMatch.result)) {
      return new RealMatch(false);
    }
    if (decimalMatch.result && decimalMatch.isSigned()) {
      return new RealMatch(false);
    }
    return new RealMatch(true, integerMatch.value, decimalMatch.value);
  }
  function checkExtendedReal(value2) {
    const first_e_index = value2.indexOf("e");
    const first_E_index = value2.indexOf("E");
    if (first_e_index === -1 && first_E_index === -1) {
      return new RealMatch(false);
    }
    const exponentIndex = first_e_index === -1 ? first_E_index : first_e_index;
    const basicRealPart = value2.substring(0, exponentIndex);
    const exponentPart = value2.substring(exponentIndex + 1);
    if (basicRealPart === "" || exponentPart == "") {
      return new RealMatch(false);
    }
    const basicRealMatch = checkBasicReal(basicRealPart);
    if (!basicRealMatch.result) {
      return new RealMatch(false);
    }
    const exponentMatch = universalMatch(exponentPart, 3 /* REAL */);
    if (!exponentMatch.result) {
      return new RealMatch(false);
    }
    return new RealMatch(
      true,
      basicRealMatch.integer,
      basicRealMatch.decimal,
      exponentMatch
    );
  }
  const count = (value.match(/[eE]/g) || []).length;
  if (count === 0) {
    return checkBasicReal(value);
  }
  return checkExtendedReal(value);
}
function isComplex(value) {
  const count = (value.match(/i/g) || []).length;
  if (count < 1) {
    return new ComplexMatch(false);
  }
  if (value[value.length - 1] !== "i") {
    return new ComplexMatch(false);
  }
  const splitPoint = value.search(/(?<!^)[+-]/);
  if (splitPoint === -1) {
    const imaginaryPart2 = value.slice(0, -1);
    const imaginaryMatch2 = universalMatch(imaginaryPart2, 3 /* REAL */);
    if (imaginaryMatch2.result) {
      return new ComplexMatch(true, void 0, void 0, imaginaryMatch2);
    }
    return new ComplexMatch(false);
  }
  const realPart = value.slice(0, splitPoint);
  let imaginaryPart = value.slice(splitPoint + 1, -1);
  if (imaginaryPart[0] !== "+" && imaginaryPart[0] !== "-") {
    imaginaryPart = "+" + imaginaryPart;
  }
  const realMatch = universalMatch(realPart, 3 /* REAL */);
  const imaginaryMatch = universalMatch(imaginaryPart, 3 /* REAL */);
  if (!(realMatch.result && imaginaryMatch.result)) {
    return new ComplexMatch(false);
  }
  return new ComplexMatch(true, realMatch, value[splitPoint], imaginaryMatch);
}
function universalMatch(value, finalWillingType) {
  const integerMatch = isInteger(value);
  if (integerMatch.result && finalWillingType >= 1 /* INTEGER */) {
    return integerMatch;
  }
  const rationalMatch = isRational(value);
  if (rationalMatch.result && finalWillingType >= 2 /* RATIONAL */) {
    return rationalMatch;
  }
  const realMatch = isReal(value);
  if (realMatch.result && finalWillingType >= 3 /* REAL */) {
    return realMatch;
  }
  const complexMatch = isComplex(value);
  if (complexMatch.result && finalWillingType >= 4 /* COMPLEX */) {
    return complexMatch;
  }
  return new IntegerMatch(false);
}
function stringIsSchemeNumber(value) {
  const match = universalMatch(value, 4 /* COMPLEX */);
  return match.result;
}
var SchemeInteger = class _SchemeInteger {
  constructor(value) {
    this.numberType = 1 /* INTEGER */;
    this.value = value;
  }
  static {
    this.EXACT_ZERO = new _SchemeInteger(0n);
  }
  // Factory method for creating a new SchemeInteger instance.
  // Force prevents automatic downcasting to a lower type.
  static build(value, _force = false) {
    const val = BigInt(value);
    if (val === 0n) {
      return _SchemeInteger.EXACT_ZERO;
    }
    return new _SchemeInteger(val);
  }
  promote(nType) {
    switch (nType) {
      case 1 /* INTEGER */:
        return this;
      case 2 /* RATIONAL */:
        return SchemeRational.build(this.value, 1n, true);
      case 3 /* REAL */:
        return SchemeReal.build(this.coerce(), true);
      case 4 /* COMPLEX */:
        return SchemeComplex.build(this, _SchemeInteger.EXACT_ZERO, true);
    }
  }
  equals(other) {
    return other instanceof _SchemeInteger && this.value === other.value;
  }
  greaterThan(other) {
    return this.value > other.value;
  }
  negate() {
    if (this === _SchemeInteger.EXACT_ZERO) {
      return this;
    }
    return _SchemeInteger.build(-this.value);
  }
  multiplicativeInverse() {
    if (this === _SchemeInteger.EXACT_ZERO) {
      throw new Error("Division by zero");
    }
    return SchemeRational.build(1n, this.value, false);
  }
  add(other) {
    return _SchemeInteger.build(this.value + other.value);
  }
  multiply(other) {
    return _SchemeInteger.build(this.value * other.value);
  }
  getBigInt() {
    return this.value;
  }
  coerce() {
    if (this.value > Number.MAX_SAFE_INTEGER) {
      return Infinity;
    }
    if (this.value < Number.MIN_SAFE_INTEGER) {
      return -Infinity;
    }
    return Number(this.value);
  }
  toString() {
    return this.value.toString();
  }
};
var SchemeRational = class _SchemeRational {
  constructor(numerator, denominator) {
    this.numberType = 2 /* RATIONAL */;
    this.numerator = numerator;
    this.denominator = denominator;
  }
  // Builds a rational number.
  // Force prevents automatic downcasting to a lower type.
  static build(numerator, denominator, force = false) {
    return _SchemeRational.simplify(
      BigInt(numerator),
      BigInt(denominator),
      force
    );
  }
  static simplify(numerator, denominator, force = false) {
    const gcd = (a, b) => {
      if (b === 0n) {
        return a;
      }
      return gcd(b, a.valueOf() % b.valueOf());
    };
    const divisor = gcd(numerator, denominator);
    const numeratorSign = numerator < 0n ? -1n : 1n;
    const denominatorSign = denominator < 0n ? -1n : 1n;
    const sign = numeratorSign * denominatorSign;
    numerator = numerator * numeratorSign;
    denominator = denominator * denominatorSign;
    if (denominator === 1n && !force) {
      return SchemeInteger.build(sign * numerator);
    }
    return new _SchemeRational(
      sign * numerator / divisor,
      denominator / divisor
    );
  }
  getNumerator() {
    return this.numerator;
  }
  getDenominator() {
    return this.denominator;
  }
  promote(nType) {
    switch (nType) {
      case 2 /* RATIONAL */:
        return this;
      case 3 /* REAL */:
        return SchemeReal.build(this.coerce(), true);
      case 4 /* COMPLEX */:
        return SchemeComplex.build(this, SchemeInteger.EXACT_ZERO, true);
      default:
        throw new Error("Unable to demote rational");
    }
  }
  equals(other) {
    return other instanceof _SchemeRational && this.numerator === other.numerator && this.denominator === other.denominator;
  }
  greaterThan(other) {
    return this.numerator * other.denominator > other.numerator * this.denominator;
  }
  negate() {
    return _SchemeRational.build(
      -this.numerator,
      this.denominator
    );
  }
  multiplicativeInverse() {
    if (this.numerator === 0n) {
      throw new Error("Division by zero");
    }
    return _SchemeRational.build(this.denominator, this.numerator);
  }
  add(other) {
    const newNumerator = this.numerator * other.denominator + other.numerator * this.denominator;
    const newDenominator = this.denominator * other.denominator;
    return _SchemeRational.build(newNumerator, newDenominator);
  }
  multiply(other) {
    const newNumerator = this.numerator * other.numerator;
    const newDenominator = this.denominator * other.denominator;
    return _SchemeRational.build(newNumerator, newDenominator);
  }
  coerce() {
    const workingNumerator = this.numerator < 0n ? -this.numerator : this.numerator;
    let converterDenominator = this.denominator;
    const wholePart = Number(workingNumerator / converterDenominator);
    if (wholePart > Number.MAX_VALUE) {
      return this.numerator < 0n ? -Infinity : Infinity;
    }
    let remainder = workingNumerator % converterDenominator;
    while (remainder > Number.MAX_SAFE_INTEGER || converterDenominator > Number.MAX_SAFE_INTEGER) {
      remainder = remainder / 2n;
      converterDenominator = converterDenominator / 2n;
    }
    const remainderPart = Number(remainder) / Number(converterDenominator);
    return this.numerator < 0n ? -(wholePart + remainderPart) : wholePart + remainderPart;
  }
  toString() {
    return `${this.numerator}/${this.denominator}`;
  }
};
var SchemeReal = class _SchemeReal {
  constructor(value) {
    this.numberType = 3 /* REAL */;
    this.value = value;
  }
  static {
    this.INEXACT_ZERO = new _SchemeReal(0);
  }
  static {
    this.INEXACT_NEG_ZERO = new _SchemeReal(-0);
  }
  static {
    this.INFINITY = new _SchemeReal(Infinity);
  }
  static {
    this.NEG_INFINITY = new _SchemeReal(-Infinity);
  }
  static {
    this.NAN = new _SchemeReal(NaN);
  }
  static build(value, _force = false) {
    if (value === Infinity) {
      return _SchemeReal.INFINITY;
    } else if (value === -Infinity) {
      return _SchemeReal.NEG_INFINITY;
    } else if (isNaN(value)) {
      return _SchemeReal.NAN;
    } else if (value === 0) {
      return _SchemeReal.INEXACT_ZERO;
    } else if (value === -0) {
      return _SchemeReal.INEXACT_NEG_ZERO;
    }
    return new _SchemeReal(value);
  }
  promote(nType) {
    switch (nType) {
      case 3 /* REAL */:
        return this;
      case 4 /* COMPLEX */:
        return SchemeComplex.build(this, SchemeInteger.EXACT_ZERO, true);
      default:
        throw new Error("Unable to demote real");
    }
  }
  equals(other) {
    return other instanceof _SchemeReal && this.value === other.value;
  }
  greaterThan(other) {
    return this.value > other.value;
  }
  negate() {
    return _SchemeReal.build(-this.value);
  }
  multiplicativeInverse() {
    if (this === _SchemeReal.INEXACT_ZERO || this === _SchemeReal.INEXACT_NEG_ZERO) {
      throw new Error("Division by zero");
    }
    return _SchemeReal.build(1 / this.value);
  }
  add(other) {
    return _SchemeReal.build(this.value + other.value);
  }
  multiply(other) {
    return _SchemeReal.build(this.value * other.value);
  }
  coerce() {
    return this.value;
  }
  toString() {
    if (this === _SchemeReal.INFINITY) {
      return "+inf.0";
    }
    if (this === _SchemeReal.NEG_INFINITY) {
      return "-inf.0";
    }
    if (this === _SchemeReal.NAN) {
      return "+nan.0";
    }
    return this.value.toString();
  }
};
var SchemeComplex = class _SchemeComplex {
  constructor(real, imaginary) {
    this.numberType = 4 /* COMPLEX */;
    this.real = real;
    this.imaginary = imaginary;
  }
  static build(real, imaginary, force = false) {
    return _SchemeComplex.simplify(new _SchemeComplex(real, imaginary), force);
  }
  static simplify(complex, force) {
    if (!force && atomic_equals(complex.imaginary, SchemeInteger.EXACT_ZERO)) {
      return complex.real;
    }
    return complex;
  }
  promote(nType) {
    switch (nType) {
      case 4 /* COMPLEX */:
        return this;
      default:
        throw new Error("Unable to demote complex");
    }
  }
  negate() {
    return _SchemeComplex.build(this.real.negate(), this.imaginary.negate());
  }
  equals(other) {
    return atomic_equals(this.real, other.real) && atomic_equals(this.imaginary, other.imaginary);
  }
  greaterThan(other) {
    return atomic_greater_than(this.real, other.real) && atomic_greater_than(this.imaginary, other.imaginary);
  }
  multiplicativeInverse() {
    const denominator = atomic_add(
      atomic_multiply(this.real, this.real),
      atomic_multiply(this.imaginary, this.imaginary)
    );
    return _SchemeComplex.build(
      atomic_multiply(denominator.multiplicativeInverse(), this.real),
      atomic_multiply(
        denominator.multiplicativeInverse(),
        this.imaginary.negate()
      )
    );
  }
  add(other) {
    return _SchemeComplex.build(
      atomic_add(this.real, other.real),
      atomic_add(this.imaginary, other.imaginary)
    );
  }
  multiply(other) {
    const realPart = atomic_subtract(
      atomic_multiply(this.real, other.real),
      atomic_multiply(this.imaginary, other.imaginary)
    );
    const imaginaryPart = atomic_add(
      atomic_multiply(this.real, other.imaginary),
      atomic_multiply(this.imaginary, other.real)
    );
    return _SchemeComplex.build(realPart, imaginaryPart);
  }
  getReal() {
    return this.real;
  }
  getImaginary() {
    return this.imaginary;
  }
  coerce() {
    throw new Error("Cannot coerce a complex number to a javascript number");
  }
  toPolar() {
    const real = this.real.promote(3 /* REAL */);
    const imaginary = this.imaginary.promote(3 /* REAL */);
    const magnitude = SchemeReal.build(
      Math.sqrt(
        real.coerce() * real.coerce() + imaginary.coerce() * imaginary.coerce()
      )
    );
    const angle = SchemeReal.build(
      Math.atan2(imaginary.coerce(), real.coerce())
    );
    return SchemePolar.build(magnitude, angle);
  }
  toString() {
    return `${this.real}+${this.imaginary}i`;
  }
};
var SchemePolar = class _SchemePolar {
  constructor(magnitude, angle) {
    this.magnitude = magnitude;
    this.angle = angle;
  }
  static build(magnitude, angle) {
    return new _SchemePolar(magnitude, angle);
  }
  // converts the polar number back to a cartesian complex number
  toCartesian() {
    const real = SchemeReal.build(
      this.magnitude.coerce() * Math.cos(this.angle.coerce())
    );
    const imaginary = SchemeReal.build(
      this.magnitude.coerce() * Math.sin(this.angle.coerce())
    );
    return SchemeComplex.build(real, imaginary);
  }
};
var infinity = SchemeReal.INFINITY;
var nan = SchemeReal.NAN;
function simplify(a) {
  switch (a.numberType) {
    case 1 /* INTEGER */:
      return a;
    case 2 /* RATIONAL */:
      return a.getDenominator() === 1n ? SchemeInteger.build(a.getNumerator()) : a;
    case 3 /* REAL */:
      return a;
    case 4 /* COMPLEX */:
      return SchemeComplex.build(
        simplify(a.getReal()),
        simplify(a.getImaginary())
      );
  }
}
function equalify(a, b) {
  if (a.numberType > b.numberType) {
    return [a, b.promote(a.numberType)];
  } else if (a.numberType < b.numberType) {
    return [a.promote(b.numberType), b];
  }
  return [a, b];
}
function atomic_negate(a) {
  return a.negate();
}
function atomic_equals(a, b) {
  const [newA, newB] = equalify(a, b);
  return newA.equals(newB);
}
function atomic_greater_than(a, b) {
  const [newA, newB] = equalify(a, b);
  return newA.greaterThan(newB);
}
function atomic_add(a, b) {
  const [newA, newB] = equalify(a, b);
  return simplify(newA.add(newB));
}
function atomic_multiply(a, b) {
  const [newA, newB] = equalify(a, b);
  return simplify(newA.multiply(newB));
}
function atomic_subtract(a, b) {
  return atomic_add(a, atomic_negate(b));
}
var PI = SchemeReal.build(Math.PI);
var E = SchemeReal.build(Math.E);
var SQRT2 = SchemeReal.build(Math.SQRT2);
var LN2 = SchemeReal.build(Math.LN2);
var LN10 = SchemeReal.build(Math.LN10);
var LOG2E = SchemeReal.build(Math.LOG2E);
var LOG10E = SchemeReal.build(Math.LOG10E);
var SQRT1_2 = SchemeReal.build(Math.SQRT1_2);

// src/scheme_parser/transpiler/types/location.ts
var Location = class _Location {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  merge(other) {
    return new _Location(this.start, other.end);
  }
};
var Position = class {
  constructor(line, column) {
    this.line = line;
    this.column = column;
  }
};

// src/scheme_parser/transpiler/parser/parser-error.ts
function extractLine(source, pos) {
  const lines = source.split("\n");
  return lines[pos.line - 1];
}
function showPoint(pos) {
  return "^".padStart(pos.column, " ");
}
var ParserError = class extends SyntaxError {
  constructor(message, pos) {
    super(`Syntax error at (${pos.line}:${pos.column})
${message}`);
    this.loc = pos;
  }
  toString() {
    return this.message;
  }
};
var UnexpectedEOFError = class extends ParserError {
  constructor(source, pos) {
    super(extractLine(source, pos) + "\nUnexpected EOF", pos);
    this.name = "UnexpectedEOFError";
  }
};
var UnexpectedFormError = class extends ParserError {
  constructor(source, pos, form) {
    super(
      extractLine(source, pos) + "\n" + showPoint(pos) + `
Unexpected '${form}'`,
      pos
    );
    this.form = form;
    this.name = "UnexpectedTokenError";
  }
};
var ExpectedFormError = class extends ParserError {
  constructor(source, pos, form, expected) {
    super(
      extractLine(source, pos) + "\n" + showPoint(pos) + `
Expected '${expected}' but got '${form}'`,
      pos
    );
    this.form = form;
    this.expected = expected;
    this.name = "ExpectedTokenError";
  }
};
var DisallowedTokenError = class extends ParserError {
  constructor(source, pos, token, chapter) {
    super(
      extractLine(source, pos) + "\n" + showPoint(pos) + `
Syntax '${token}' not allowed at Scheme \xA7${chapter}`,
      pos
    );
    this.token = token;
    this.name = "DisallowedTokenError";
  }
};
var UnsupportedTokenError = class extends ParserError {
  constructor(source, pos, token) {
    super(
      extractLine(source, pos) + "\n" + showPoint(pos) + `
Syntax '${token}' not supported yet`,
      pos
    );
    this.token = token;
    this.name = "UnsupportedTokenError";
  }
};

// src/scheme_parser/transpiler/types/tokens/group.ts
var Group = class _Group {
  constructor(elements) {
    this.elements = elements;
    this.location = new Location(this.firstPos(), this.lastPos());
  }
  /**
   * A constructor function for a group that enforces group invariants.
   */
  static build(elements) {
    function matchingParentheses(lParen, rParen) {
      return lParen.type === 0 /* LEFT_PAREN */ && rParen.type === 1 /* RIGHT_PAREN */ || lParen.type === 2 /* LEFT_BRACKET */ && rParen.type === 3 /* RIGHT_BRACKET */;
    }
    function isDataType(token) {
      return token.type === 6 /* IDENTIFIER */ || token.type === 7 /* NUMBER */ || token.type === 9 /* STRING */ || token.type === 8 /* BOOLEAN */;
    }
    function isShortAffector(token) {
      return token.type === 16 /* APOSTROPHE */ || token.type === 17 /* BACKTICK */ || token.type === 31 /* HASH_VECTOR */ || token.type === 18 /* COMMA */ || token.type === 19 /* COMMA_AT */;
    }
    if (elements.length === 0) {
      throw new Error("Illegal empty group. This should never happen.");
    }
    if (elements.length === 1) {
      const onlyElement = elements[0];
      if (isGroup(onlyElement)) {
        return onlyElement;
      }
      if (!isDataType(onlyElement)) {
        throw new ExpectedFormError("", onlyElement.pos, onlyElement, "<data>");
      }
      return new _Group(elements);
    }
    if (elements.length === 2) {
      const firstElement2 = elements[0];
      if (isToken(firstElement2) && isShortAffector(firstElement2)) {
        return new _Group(elements);
      }
    }
    const firstElement = elements[0];
    const lastElement = elements[elements.length - 1];
    if (isToken(firstElement) && isToken(lastElement) && matchingParentheses(firstElement, lastElement)) {
      return new _Group(elements);
    }
    const wrongGroup = new _Group(elements);
    throw new ExpectedFormError(
      "",
      wrongGroup.location.start,
      wrongGroup,
      "matching parentheses"
    );
  }
  // Get the first element of the group.
  first() {
    return this.elements[0];
  }
  // Get the first token of the group.
  firstToken() {
    const firstElement = this.first();
    if (isToken(firstElement)) {
      return firstElement;
    } else {
      return firstElement.firstToken();
    }
  }
  // Get the starting position of the first element of the group.
  firstPos() {
    return this.firstToken().pos;
  }
  // Get the last element of the group.
  last() {
    return this.elements[this.elements.length - 1];
  }
  lastToken() {
    const lastElement = this.last();
    if (isToken(lastElement)) {
      return lastElement;
    } else {
      return lastElement.lastToken();
    }
  }
  // Get the ending position of the last element of the group.
  lastPos() {
    return this.lastToken().pos;
  }
  /**
   * Check if the current group is parenthesized.
   */
  isParenthesized() {
    const firstElement = this.first();
    return isToken(firstElement) && (firstElement.type === 0 /* LEFT_PAREN */ || firstElement.type === 2 /* LEFT_BRACKET */);
  }
  /**
   * Using the invariants, we can determine if a group actually
   * represents a singular identifier.
   */
  isSingleIdentifier() {
    return !this.isParenthesized() && this.length() === 1;
  }
  /**
   * Get the internal elements of the group.
   * If the group is bounded by parentheses, the parentheses are excluded.
   * @returns All elements of the group excluding parentheses.
   */
  unwrap() {
    if (this.isParenthesized()) {
      return this.elements.slice(1, this.elements.length - 1);
    }
    return this.elements;
  }
  /**
   * Get the number of elements in the group.
   * Ignores parentheses.
   * @returns The number of elements in the group.
   */
  length() {
    return this.unwrap().length;
  }
  /**
   * @returns A string representation of the group
   */
  toString() {
    return this.elements.map((e) => e.toString()).join(" ");
  }
};

// src/scheme_parser/transpiler/types/tokens/index.ts
function isToken(datum) {
  return datum instanceof Token;
}
function isGroup(datum) {
  return datum instanceof Group;
}

// src/scheme_parser/transpiler/types/tokens/token.ts
var Token = class _Token {
  constructor(type, lexeme, literal, start, end, line, col) {
    this.type = type;
    this.lexeme = lexeme;
    this.literal = literal;
    this.start = start;
    this.end = end;
    this.pos = new Position(line, col);
    this.endPos = new Position(line, col + lexeme.length - 1);
  }
  /**
   * Converts a token to another representation of itself.
   * Especially useful for quotation tokens.
   * @returns A converted token.
   */
  convertToken() {
    switch (this.type) {
      case 16 /* APOSTROPHE */:
        return new _Token(
          20 /* QUOTE */,
          this.lexeme,
          this.literal,
          this.start,
          this.end,
          this.pos.line,
          this.pos.column
        );
      case 17 /* BACKTICK */:
        return new _Token(
          21 /* QUASIQUOTE */,
          this.lexeme,
          this.literal,
          this.start,
          this.end,
          this.pos.line,
          this.pos.column
        );
      case 31 /* HASH_VECTOR */:
        return new _Token(
          32 /* VECTOR */,
          this.lexeme,
          this.literal,
          this.start,
          this.end,
          this.pos.line,
          this.pos.column
        );
      case 18 /* COMMA */:
        return new _Token(
          22 /* UNQUOTE */,
          this.lexeme,
          this.literal,
          this.start,
          this.end,
          this.pos.line,
          this.pos.column
        );
      case 19 /* COMMA_AT */:
        return new _Token(
          23 /* UNQUOTE_SPLICING */,
          this.lexeme,
          this.literal,
          this.start,
          this.end,
          this.pos.line,
          this.pos.column
        );
      default:
        return this;
    }
  }
  /**
   * For debugging.
   * @returns A string representation of the token.
   */
  toString() {
    return `${this.lexeme}`;
  }
};

// src/scheme_parser/transpiler/lexer/lexer-error.ts
var LexerError = class extends SyntaxError {
  constructor(message, line, col) {
    super(message);
    this.loc = {
      line,
      column: col
    };
  }
  toString() {
    return this.message;
  }
};
var UnexpectedCharacterError = class extends LexerError {
  constructor(line, col, char) {
    super(`Unexpected character '${char}' (${line}:${col})`, line, col);
    this.char = char;
    this.name = "UnexpectedCharacterError";
  }
};
var UnexpectedEOFError2 = class extends LexerError {
  constructor(line, col) {
    super(`Unexpected EOF (${line}:${col})`, line, col);
    this.name = "UnexpectedEOFError";
  }
};

// src/scheme_parser/transpiler/lexer/scheme-lexer.ts
var keywords = /* @__PURE__ */ new Map([
  [".", 4 /* DOT */],
  ["if", 10 /* IF */],
  ["let", 11 /* LET */],
  ["cond", 12 /* COND */],
  ["else", 13 /* ELSE */],
  ["set!", 24 /* SET */],
  ["begin", 25 /* BEGIN */],
  ["delay", 26 /* DELAY */],
  ["quote", 20 /* QUOTE */],
  ["export", 28 /* EXPORT */],
  ["import", 27 /* IMPORT */],
  ["define", 14 /* DEFINE */],
  ["lambda", 15 /* LAMBDA */],
  ["define-syntax", 29 /* DEFINE_SYNTAX */],
  ["syntax-rules", 30 /* SYNTAX_RULES */]
]);
var SchemeLexer = class {
  constructor(source) {
    this.start = 0;
    this.current = 0;
    this.line = 1;
    this.col = 0;
    this.source = source;
    this.tokens = [];
  }
  isAtEnd() {
    return this.current >= this.source.length;
  }
  advance() {
    this.col++;
    return this.source.charAt(this.current++);
  }
  jump() {
    this.start = this.current;
    this.col++;
    this.current++;
  }
  addToken(type, literal = null) {
    const text = this.source.substring(this.start, this.current);
    this.tokens.push(
      new Token(
        type,
        text,
        literal,
        this.start,
        this.current,
        this.line,
        this.col
      )
    );
  }
  scanTokens() {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }
    this.tokens.push(
      new Token(
        33 /* EOF */,
        "",
        null,
        this.start,
        this.current,
        this.line,
        this.col
      )
    );
    return this.tokens;
  }
  scanToken() {
    const c = this.advance();
    switch (c) {
      case "(":
        this.addToken(0 /* LEFT_PAREN */);
        break;
      case ")":
        this.addToken(1 /* RIGHT_PAREN */);
        break;
      case "[":
        this.addToken(2 /* LEFT_BRACKET */);
        break;
      case "]":
        this.addToken(3 /* RIGHT_BRACKET */);
        break;
      case "'":
        this.addToken(16 /* APOSTROPHE */);
        break;
      case "`":
        this.addToken(17 /* BACKTICK */);
        break;
      case ",":
        if (this.match("@")) {
          this.addToken(19 /* COMMA_AT */);
          break;
        }
        this.addToken(18 /* COMMA */);
        break;
      case "#":
        if (this.match("t") || this.match("f")) {
          this.booleanToken();
        } else if (this.match("|")) {
          this.comment();
        } else if (this.match(";")) {
          this.addToken(5 /* HASH_SEMICOLON */);
        } else if (this.peek() === "(" || this.peek() === "[") {
          this.addToken(31 /* HASH_VECTOR */);
        } else {
          throw new UnexpectedCharacterError(this.line, this.col, c);
        }
        break;
      case ";":
        while (this.peek() != "\n" && !this.isAtEnd()) this.advance();
        break;
      // double character tokens not currently needed
      case " ":
      case "\r":
      case "	":
        break;
      case "\n":
        this.line++;
        this.col = 0;
        break;
      case '"':
        this.stringToken();
        break;
      case "|":
        this.identifierTokenLoose();
        break;
      default:
        if (this.isDigit(c) || c === "-" || c === "+" || c === "." || c === "i" || // inf
        c === "n") {
          this.identifierNumberToken();
        } else if (this.isValidIdentifier(c)) {
          this.identifierToken();
        } else {
          throw new UnexpectedCharacterError(this.line, this.col, c);
        }
        break;
    }
  }
  comment() {
    while (!(this.peek() == "|" && this.peekNext() == "#") && !this.isAtEnd()) {
      if (this.peek() === "\n") {
        this.line++;
        this.col = 0;
      }
      this.advance();
    }
    if (this.isAtEnd()) {
      throw new UnexpectedEOFError2(this.line, this.col);
    }
    this.jump();
    this.jump();
  }
  identifierToken() {
    while (this.isValidIdentifier(this.peek())) this.advance();
    this.addToken(this.checkKeyword());
  }
  identifierTokenLoose() {
    this.advance();
    while (this.peek() != "|" && !this.isAtEnd()) {
      if (this.peek() === "\n") {
        this.line++;
        this.col = 0;
      }
      this.advance();
    }
    if (this.isAtEnd()) {
      throw new UnexpectedEOFError2(this.line, this.col);
    }
    this.advance();
    this.addToken(this.checkKeyword());
  }
  identifierNumberToken() {
    while (this.isValidIdentifier(this.peek())) {
      this.advance();
    }
    const lexeme = this.source.substring(this.start, this.current);
    if (stringIsSchemeNumber(lexeme)) {
      this.addToken(7 /* NUMBER */, lexeme);
      return;
    }
    this.addToken(this.checkKeyword());
  }
  checkKeyword() {
    const text = this.source.substring(this.start, this.current);
    if (keywords.has(text)) {
      return keywords.get(text);
    }
    return 6 /* IDENTIFIER */;
  }
  stringToken() {
    while (this.peek() != '"' && !this.isAtEnd()) {
      if (this.peek() === "\n") {
        this.line++;
        this.col = 0;
      }
      this.advance();
    }
    if (this.isAtEnd()) {
      throw new UnexpectedEOFError2(this.line, this.col);
    }
    this.advance();
    const value = this.source.substring(this.start + 1, this.current - 1);
    this.addToken(9 /* STRING */, value);
  }
  booleanToken() {
    this.addToken(8 /* BOOLEAN */, this.peekPrev() === "t" ? true : false);
  }
  match(expected) {
    if (this.isAtEnd()) return false;
    if (this.source.charAt(this.current) != expected) return false;
    this.current++;
    return true;
  }
  peek() {
    if (this.isAtEnd()) return "\0";
    return this.source.charAt(this.current);
  }
  peekNext() {
    if (this.current + 1 >= this.source.length) return "\0";
    return this.source.charAt(this.current + 1);
  }
  peekPrev() {
    if (this.current - 1 < 0) return "\0";
    return this.source.charAt(this.current - 1);
  }
  isDigit(c) {
    return c >= "0" && c <= "9";
  }
  isSpecialSyntax(c) {
    return c === "(" || c === ")" || c === "[" || c === "]" || c === ";" || c === "|";
  }
  isValidIdentifier(c) {
    return !this.isWhitespace(c) && !this.isSpecialSyntax(c);
  }
  isWhitespace(c) {
    return c === " " || c === "\0" || c === "\n" || c === "\r" || c === "	";
  }
};

// src/scheme_parser/transpiler/types/nodes/scheme-node-types.ts
var Atomic;
((Atomic2) => {
  class Sequence {
    constructor(location, expressions) {
      this.location = location;
      this.expressions = expressions;
    }
    accept(visitor) {
      return visitor.visitSequence(this);
    }
    equals(other) {
      if (other instanceof Sequence) {
        if (this.expressions.length !== other.expressions.length) {
          return false;
        }
        for (let i = 0; i < this.expressions.length; i++) {
          if (!this.expressions[i].equals(other.expressions[i])) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }
  Atomic2.Sequence = Sequence;
  class NumericLiteral {
    constructor(location, value) {
      this.location = location;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitNumericLiteral(this);
    }
    equals(other) {
      if (other instanceof NumericLiteral) {
        return this.value === other.value;
      }
      return false;
    }
  }
  Atomic2.NumericLiteral = NumericLiteral;
  class BooleanLiteral {
    constructor(location, value) {
      this.location = location;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitBooleanLiteral(this);
    }
    equals(other) {
      if (other instanceof BooleanLiteral) {
        return this.value === other.value;
      }
      return false;
    }
  }
  Atomic2.BooleanLiteral = BooleanLiteral;
  class StringLiteral {
    constructor(location, value) {
      this.location = location;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitStringLiteral(this);
    }
    equals(other) {
      if (other instanceof StringLiteral) {
        return this.value === other.value;
      }
      return false;
    }
  }
  Atomic2.StringLiteral = StringLiteral;
  class Lambda4 {
    constructor(location, body, params, rest = void 0) {
      this.location = location;
      this.params = params;
      this.rest = rest;
      this.body = body;
    }
    accept(visitor) {
      return visitor.visitLambda(this);
    }
    equals(other) {
      if (other instanceof Lambda4) {
        if (this.params.length !== other.params.length) {
          return false;
        }
        for (let i = 0; i < this.params.length; i++) {
          if (!this.params[i].equals(other.params[i])) {
            return false;
          }
        }
        if (this.rest && other.rest) {
          if (!this.rest.equals(other.rest)) {
            return false;
          }
        } else if (this.rest || other.rest) {
          return false;
        }
        return this.body.equals(other.body);
      }
      return false;
    }
  }
  Atomic2.Lambda = Lambda4;
  class Identifier {
    constructor(location, name) {
      this.location = location;
      this.name = name;
    }
    accept(visitor) {
      return visitor.visitIdentifier(this);
    }
    equals(other) {
      if (other instanceof Identifier) {
        return this.name === other.name;
      }
      return false;
    }
  }
  Atomic2.Identifier = Identifier;
  class Definition2 {
    constructor(location, name, value) {
      this.location = location;
      this.name = name;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitDefinition(this);
    }
    equals(other) {
      if (other instanceof Definition2) {
        return this.name.equals(other.name) && this.value.equals(other.value);
      }
      return false;
    }
  }
  Atomic2.Definition = Definition2;
  class Application4 {
    constructor(location, operator, operands) {
      this.location = location;
      this.operator = operator;
      this.operands = operands;
    }
    accept(visitor) {
      return visitor.visitApplication(this);
    }
    equals(other) {
      if (other instanceof Application4) {
        if (!this.operator.equals(other.operator)) {
          return false;
        }
        if (this.operands.length !== other.operands.length) {
          return false;
        }
        for (let i = 0; i < this.operands.length; i++) {
          if (!this.operands[i].equals(other.operands[i])) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }
  Atomic2.Application = Application4;
  class Conditional {
    constructor(location, test, consequent, alternate) {
      this.location = location;
      this.test = test;
      this.consequent = consequent;
      this.alternate = alternate;
    }
    accept(visitor) {
      return visitor.visitConditional(this);
    }
    equals(other) {
      if (other instanceof Conditional) {
        return this.test.equals(other.test) && this.consequent.equals(other.consequent) && this.alternate.equals(other.alternate);
      }
      return false;
    }
  }
  Atomic2.Conditional = Conditional;
  class Pair2 {
    constructor(location, car, cdr) {
      this.location = location;
      this.car = car;
      this.cdr = cdr;
    }
    accept(visitor) {
      return visitor.visitPair(this);
    }
    equals(other) {
      if (other instanceof Pair2) {
        return this.car.equals(other.car) && this.cdr.equals(other.cdr);
      }
      return false;
    }
  }
  Atomic2.Pair = Pair2;
  class Nil4 {
    constructor(location) {
      this.location = location;
    }
    accept(visitor) {
      return visitor.visitNil(this);
    }
    equals(other) {
      return other instanceof Nil4;
    }
  }
  Atomic2.Nil = Nil4;
  class Symbol {
    constructor(location, value) {
      this.location = location;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitSymbol(this);
    }
    equals(other) {
      if (other instanceof Symbol) {
        return this.value === other.value;
      }
      return false;
    }
  }
  Atomic2.Symbol = Symbol;
  class SpliceMarker {
    constructor(location, value) {
      this.location = location;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitSpliceMarker(this);
    }
    equals(other) {
      if (other instanceof SpliceMarker) {
        return this.value.equals(other.value);
      }
      return false;
    }
  }
  Atomic2.SpliceMarker = SpliceMarker;
  class Reassignment {
    constructor(location, name, value) {
      this.location = location;
      this.name = name;
      this.value = value;
    }
    accept(visitor) {
      return visitor.visitReassignment(this);
    }
    equals(other) {
      if (other instanceof Reassignment) {
        return this.name.equals(other.name) && this.value.equals(other.value);
      }
      return false;
    }
  }
  Atomic2.Reassignment = Reassignment;
  class Import {
    constructor(location, source, identifiers) {
      this.location = location;
      this.source = source;
      this.identifiers = identifiers;
    }
    accept(visitor) {
      return visitor.visitImport(this);
    }
    equals(other) {
      if (other instanceof Import) {
        if (!this.source.equals(other.source)) {
          return false;
        }
        if (this.identifiers.length !== other.identifiers.length) {
          return false;
        }
        for (let i = 0; i < this.identifiers.length; i++) {
          if (!this.identifiers[i].equals(other.identifiers[i])) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }
  Atomic2.Import = Import;
  class Export {
    constructor(location, definition) {
      this.location = location;
      this.definition = definition;
    }
    accept(visitor) {
      return visitor.visitExport(this);
    }
    equals(other) {
      if (other instanceof Export) {
        return this.definition.equals(other.definition);
      }
      return false;
    }
  }
  Atomic2.Export = Export;
  class Vector {
    constructor(location, elements) {
      this.location = location;
      this.elements = elements;
    }
    accept(visitor) {
      return visitor.visitVector(this);
    }
    equals(other) {
      if (other instanceof Vector) {
        if (this.elements.length !== other.elements.length) {
          return false;
        }
        for (let i = 0; i < this.elements.length; i++) {
          if (!this.elements[i].equals(other.elements[i])) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }
  Atomic2.Vector = Vector;
  class DefineSyntax {
    constructor(location, name, transformer) {
      this.location = location;
      this.name = name;
      this.transformer = transformer;
    }
    accept(visitor) {
      return visitor.visitDefineSyntax(this);
    }
    equals(other) {
      if (other instanceof DefineSyntax) {
        return this.name.equals(other.name) && this.transformer.equals(other.transformer);
      }
      return false;
    }
  }
  Atomic2.DefineSyntax = DefineSyntax;
  class SyntaxRules {
    constructor(location, literals, rules) {
      this.location = location;
      this.literals = literals;
      this.rules = rules;
    }
    accept(visitor) {
      return visitor.visitSyntaxRules(this);
    }
    equals(other) {
      if (other instanceof SyntaxRules) {
        if (this.literals.length !== other.literals.length) {
          return false;
        }
        for (let i = 0; i < this.literals.length; i++) {
          if (!this.literals[i].equals(other.literals[i])) {
            return false;
          }
        }
        if (this.rules.length !== other.rules.length) {
          return false;
        }
        for (let i = 0; i < this.rules.length; i++) {
          if (!this.rules[i][0].equals(other.rules[i][0]) || !this.rules[i][1].equals(other.rules[i][1])) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }
  Atomic2.SyntaxRules = SyntaxRules;
})(Atomic || (Atomic = {}));
var Extended;
((Extended2) => {
  class FunctionDefinition {
    constructor(location, name, body, params, rest = void 0) {
      this.location = location;
      this.name = name;
      this.body = body;
      this.params = params;
      this.rest = rest;
    }
    accept(visitor) {
      return visitor.visitFunctionDefinition(this);
    }
    equals(other) {
      if (other instanceof FunctionDefinition) {
        if (this.params.length !== other.params.length) {
          return false;
        }
        for (let i = 0; i < this.params.length; i++) {
          if (!this.params[i].equals(other.params[i])) {
            return false;
          }
        }
        if (this.rest && other.rest) {
          if (!this.rest.equals(other.rest)) {
            return false;
          }
        } else if (this.rest || other.rest) {
          return false;
        }
        return this.body.equals(other.body);
      }
      return false;
    }
  }
  Extended2.FunctionDefinition = FunctionDefinition;
  class Let {
    constructor(location, identifiers, values, body) {
      this.location = location;
      this.identifiers = identifiers;
      this.values = values;
      this.body = body;
    }
    accept(visitor) {
      return visitor.visitLet(this);
    }
    equals(other) {
      if (other instanceof Let) {
        if (this.identifiers.length !== other.identifiers.length) {
          return false;
        }
        for (let i = 0; i < this.identifiers.length; i++) {
          if (!this.identifiers[i].equals(other.identifiers[i])) {
            return false;
          }
        }
        if (this.values.length !== other.values.length) {
          return false;
        }
        for (let i = 0; i < this.values.length; i++) {
          if (!this.values[i].equals(other.values[i])) {
            return false;
          }
        }
        return this.body.equals(other.body);
      }
      return false;
    }
  }
  Extended2.Let = Let;
  class Cond {
    constructor(location, predicates, consequents, catchall) {
      this.location = location;
      this.predicates = predicates;
      this.consequents = consequents;
      this.catchall = catchall;
    }
    accept(visitor) {
      return visitor.visitCond(this);
    }
    equals(other) {
      if (other instanceof Cond) {
        if (this.predicates.length !== other.predicates.length) {
          return false;
        }
        for (let i = 0; i < this.predicates.length; i++) {
          if (!this.predicates[i].equals(other.predicates[i])) {
            return false;
          }
        }
        if (this.consequents.length !== other.consequents.length) {
          return false;
        }
        for (let i = 0; i < this.consequents.length; i++) {
          if (!this.consequents[i].equals(other.consequents[i])) {
            return false;
          }
        }
        if (this.catchall && other.catchall) {
          return this.catchall.equals(other.catchall);
        } else if (this.catchall || other.catchall) {
          return false;
        }
        return true;
      }
      return false;
    }
  }
  Extended2.Cond = Cond;
  class List4 {
    constructor(location, elements, terminator = void 0) {
      this.location = location;
      this.elements = elements;
      this.terminator = terminator;
    }
    accept(visitor) {
      return visitor.visitList(this);
    }
    equals(other) {
      if (other instanceof List4) {
        if (this.elements.length !== other.elements.length) {
          return false;
        }
        for (let i = 0; i < this.elements.length; i++) {
          if (!this.elements[i].equals(other.elements[i])) {
            return false;
          }
        }
        if (this.terminator && other.terminator) {
          return this.terminator.equals(other.terminator);
        } else if (this.terminator || other.terminator) {
          return false;
        }
        return true;
      }
      return false;
    }
  }
  Extended2.List = List4;
  class Begin {
    constructor(location, expressions) {
      this.location = location;
      this.expressions = expressions;
    }
    accept(visitor) {
      return visitor.visitBegin(this);
    }
    equals(other) {
      if (other instanceof Begin) {
        if (this.expressions.length !== other.expressions.length) {
          return false;
        }
        for (let i = 0; i < this.expressions.length; i++) {
          if (!this.expressions[i].equals(other.expressions[i])) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }
  Extended2.Begin = Begin;
  class Delay2 {
    constructor(location, expression) {
      this.location = location;
      this.expression = expression;
    }
    accept(visitor) {
      return visitor.visitDelay(this);
    }
    equals(other) {
      if (other instanceof Delay2) {
        return this.expression.equals(other.expression);
      }
      return false;
    }
  }
  Extended2.Delay = Delay2;
})(Extended || (Extended = {}));

// src/scheme_parser/transpiler/types/constants.ts
var BASIC_CHAPTER = 1;
var QUOTING_CHAPTER = 2;
var VECTOR_CHAPTER = 3;
var MUTABLE_CHAPTER = 3;
var MACRO_CHAPTER = 5;

// src/scheme_parser/transpiler/parser/scheme-parser.ts
var SchemeParser = class {
  constructor(source, tokens, chapter = Infinity) {
    this.current = 0;
    this.quoteMode = 0 /* NONE */;
    this.source = source;
    this.tokens = tokens;
    this.chapter = chapter;
  }
  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }
  isAtEnd() {
    return this.current >= this.tokens.length;
  }
  previous() {
    return this.tokens[this.current - 1];
  }
  peek() {
    return this.tokens[this.current];
  }
  validateChapter(c, chapter) {
    if (this.chapter < chapter) {
      throw new DisallowedTokenError(
        this.source,
        c.pos,
        c,
        this.chapter
      );
    }
  }
  /**
   * Returns the location of a token.
   * @param token A token.
   * @returns The location of the token.
   */
  toLocation(token) {
    return new Location(token.pos, token.endPos);
  }
  /**
   * Helper function used to destructure a list into its elements and terminator.
   * An optional verifier is used if there are restrictions on the elements of the list.
   */
  destructureList(list, verifier = (_x) => {
  }) {
    if (list.length === 0) {
      return [[], void 0];
    }
    if (list.length === 1) {
      verifier(list[0]);
      return [[this.parseExpression(list[0])], void 0];
    }
    const potentialDot = list.at(-2);
    if (isToken(potentialDot) && potentialDot.type === 4 /* DOT */) {
      const cdrElement = list.at(-1);
      const listElements2 = list.slice(0, -2);
      verifier(cdrElement);
      listElements2.forEach(verifier);
      return [
        listElements2.map(this.parseExpression.bind(this)),
        this.parseExpression(cdrElement)
      ];
    }
    const listElements = list;
    listElements.forEach(verifier);
    return [listElements.map(this.parseExpression.bind(this)), void 0];
  }
  /**
   * Returns a group of associated tokens.
   * Tokens are grouped by level of parentheses.
   *
   * @param openparen The opening parenthesis, if one exists.
   * @returns A group of tokens or groups of tokens.
   */
  grouping(openparen) {
    const elements = [];
    let inList = false;
    if (openparen) {
      inList = true;
      elements.push(openparen);
    }
    do {
      const c = this.advance();
      switch (c.type) {
        case 0 /* LEFT_PAREN */:
        case 2 /* LEFT_BRACKET */:
          const innerGroup = this.grouping(c);
          elements.push(innerGroup);
          break;
        case 1 /* RIGHT_PAREN */:
        case 3 /* RIGHT_BRACKET */:
          if (!inList) {
            throw new UnexpectedFormError(this.source, c.pos, c);
          }
          elements.push(c);
          inList = false;
          break;
        case 16 /* APOSTROPHE */:
        // Quoting syntax (short form)
        case 17 /* BACKTICK */:
        case 18 /* COMMA */:
        case 19 /* COMMA_AT */:
        case 31 /* HASH_VECTOR */:
          let nextGrouping;
          do {
            nextGrouping = this.grouping();
          } while (!nextGrouping);
          elements.push(this.affect(c, nextGrouping));
          break;
        case 20 /* QUOTE */:
        // Quoting syntax
        case 21 /* QUASIQUOTE */:
        case 22 /* UNQUOTE */:
        case 23 /* UNQUOTE_SPLICING */:
        case 6 /* IDENTIFIER */:
        // Atomics
        case 7 /* NUMBER */:
        case 8 /* BOOLEAN */:
        case 9 /* STRING */:
        case 4 /* DOT */:
        case 14 /* DEFINE */:
        // Chapter 1
        case 10 /* IF */:
        case 13 /* ELSE */:
        case 12 /* COND */:
        case 15 /* LAMBDA */:
        case 11 /* LET */:
        case 24 /* SET */:
        // Chapter 3
        case 25 /* BEGIN */:
        case 26 /* DELAY */:
        case 27 /* IMPORT */:
        case 28 /* EXPORT */:
        case 29 /* DEFINE_SYNTAX */:
        case 30 /* SYNTAX_RULES */:
          elements.push(c);
          break;
        case 5 /* HASH_SEMICOLON */:
          while (!this.grouping()) {
          }
          break;
        case 33 /* EOF */:
          throw new UnexpectedEOFError(this.source, c.pos);
        default:
          throw new UnexpectedFormError(this.source, c.pos, c);
      }
    } while (inList);
    if (elements.length === 0) {
      return;
    }
    try {
      return Group.build(elements);
    } catch (e) {
      if (e instanceof ExpectedFormError) {
        throw new ExpectedFormError(
          this.source,
          e.loc,
          e.form,
          e.expected
        );
      }
      throw e;
    }
  }
  /**
   * Groups an affector token with its target.
   */
  affect(affector, target) {
    return Group.build([affector, target]);
  }
  /**
   * Parse an expression.
   * @param expr A token or a group of tokens.
   * @returns
   */
  parseExpression(expr) {
    if (isToken(expr)) {
      return this.parseToken(expr);
    }
    if (expr.isSingleIdentifier()) {
      return this.parseToken(expr.unwrap()[0]);
    }
    return this.parseGroup(expr);
  }
  parseToken(token) {
    switch (token.type) {
      case 6 /* IDENTIFIER */:
        return this.quoteMode === 0 /* NONE */ ? new Atomic.Identifier(this.toLocation(token), token.lexeme) : new Atomic.Symbol(this.toLocation(token), token.lexeme);
      // all of these are self evaluating, and so can be left alone regardless of quote mode
      case 7 /* NUMBER */:
        return new Atomic.NumericLiteral(
          this.toLocation(token),
          token.literal
        );
      case 8 /* BOOLEAN */:
        return new Atomic.BooleanLiteral(
          this.toLocation(token),
          token.literal
        );
      case 9 /* STRING */:
        return new Atomic.StringLiteral(
          this.toLocation(token),
          token.literal
        );
      default:
        if (this.quoteMode !== 0 /* NONE */ || this.chapter >= MACRO_CHAPTER) {
          return new Atomic.Symbol(this.toLocation(token), token.lexeme);
        }
        throw new UnexpectedFormError(
          this.source,
          token.pos,
          token
        );
    }
  }
  parseGroup(group) {
    if (!group.isParenthesized()) {
      return this.parseAffectorGroup(group);
    }
    switch (this.quoteMode) {
      case 0 /* NONE */:
        return this.parseNormalGroup(group);
      case 1 /* QUOTE */:
      case 2 /* QUASIQUOTE */:
        return this.parseQuotedGroup(group);
    }
  }
  /**
   * Parse a group of tokens affected by an affector.
   * Important case as affector changes quotation mode.
   *
   * @param group A group of tokens, verified to be an affector and a target.
   * @returns An expression.
   */
  parseAffectorGroup(group) {
    const [affector, target] = group.unwrap();
    switch (affector.type) {
      case 16 /* APOSTROPHE */:
      case 20 /* QUOTE */:
        this.validateChapter(affector, QUOTING_CHAPTER);
        if (this.quoteMode !== 0 /* NONE */) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(affector),
            "quote"
          );
          const newLocation2 = newSymbol.location.merge(innerGroup.location);
          return new Extended.List(newLocation2, [newSymbol, innerGroup]);
        }
        this.quoteMode = 1 /* QUOTE */;
        const quotedExpression = this.parseExpression(target);
        this.quoteMode = 0 /* NONE */;
        return quotedExpression;
      case 17 /* BACKTICK */:
      case 21 /* QUASIQUOTE */:
        this.validateChapter(affector, QUOTING_CHAPTER);
        if (this.quoteMode !== 0 /* NONE */) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(affector),
            "quasiquote"
          );
          const newLocation2 = newSymbol.location.merge(innerGroup.location);
          return new Extended.List(newLocation2, [newSymbol, innerGroup]);
        }
        this.quoteMode = 2 /* QUASIQUOTE */;
        const quasiquotedExpression = this.parseExpression(target);
        this.quoteMode = 0 /* NONE */;
        return quasiquotedExpression;
      case 18 /* COMMA */:
      case 22 /* UNQUOTE */:
        this.validateChapter(affector, QUOTING_CHAPTER);
        const preUnquoteMode = this.quoteMode;
        if (preUnquoteMode === 0 /* NONE */) {
          throw new UnsupportedTokenError(
            this.source,
            affector.pos,
            affector
          );
        }
        if (preUnquoteMode === 1 /* QUOTE */) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(affector),
            "unquote"
          );
          const newLocation2 = newSymbol.location.merge(innerGroup.location);
          return new Extended.List(newLocation2, [newSymbol, innerGroup]);
        }
        this.quoteMode = 0 /* NONE */;
        const unquotedExpression = this.parseExpression(target);
        this.quoteMode = preUnquoteMode;
        return unquotedExpression;
      case 19 /* COMMA_AT */:
      case 23 /* UNQUOTE_SPLICING */:
        this.validateChapter(affector, QUOTING_CHAPTER);
        const preUnquoteSplicingMode = this.quoteMode;
        if (preUnquoteSplicingMode === 0 /* NONE */) {
          throw new UnexpectedFormError(
            this.source,
            affector.pos,
            affector
          );
        }
        if (preUnquoteSplicingMode === 1 /* QUOTE */) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(affector),
            "unquote-splicing"
          );
          const newLocation2 = newSymbol.location.merge(innerGroup.location);
          return new Extended.List(newLocation2, [newSymbol, innerGroup]);
        }
        this.quoteMode = 0 /* NONE */;
        const unquoteSplicedExpression = this.parseExpression(target);
        this.quoteMode = preUnquoteSplicingMode;
        const newLocation = this.toLocation(affector).merge(
          unquoteSplicedExpression.location
        );
        return new Atomic.SpliceMarker(newLocation, unquoteSplicedExpression);
      case 31 /* HASH_VECTOR */:
        this.validateChapter(affector, VECTOR_CHAPTER);
        const preVectorQuoteMode = this.quoteMode;
        this.quoteMode = 1 /* QUOTE */;
        const vector = this.parseVector(group);
        this.quoteMode = preVectorQuoteMode;
        return vector;
      default:
        throw new UnexpectedFormError(
          this.source,
          affector.pos,
          affector
        );
    }
  }
  parseNormalGroup(group) {
    if (group.length() === 0) {
      if (this.chapter >= MACRO_CHAPTER) {
        return new Atomic.Nil(group.location);
      }
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "non-empty group"
      );
    }
    const firstElement = group.unwrap()[0];
    if (isToken(firstElement)) {
      switch (firstElement.type) {
        // Scheme chapter 1
        case 15 /* LAMBDA */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseLambda(group);
        case 14 /* DEFINE */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseDefinition(group);
        case 10 /* IF */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseConditional(group);
        case 11 /* LET */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseLet(group);
        case 12 /* COND */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseExtendedCond(group);
        // Scheme chapter 2
        case 20 /* QUOTE */:
        case 16 /* APOSTROPHE */:
        case 21 /* QUASIQUOTE */:
        case 17 /* BACKTICK */:
        case 22 /* UNQUOTE */:
        case 18 /* COMMA */:
        case 23 /* UNQUOTE_SPLICING */:
        case 19 /* COMMA_AT */:
          this.validateChapter(firstElement, QUOTING_CHAPTER);
          return this.parseAffectorGroup(group);
        // Scheme chapter 3
        case 25 /* BEGIN */:
          this.validateChapter(firstElement, MUTABLE_CHAPTER);
          return this.parseBegin(group);
        case 26 /* DELAY */:
          this.validateChapter(firstElement, MUTABLE_CHAPTER);
          return this.parseDelay(group);
        case 24 /* SET */:
          this.validateChapter(firstElement, MUTABLE_CHAPTER);
          return this.parseSet(group);
        // Scheme full (macros)
        case 29 /* DEFINE_SYNTAX */:
          this.validateChapter(firstElement, MACRO_CHAPTER);
          return this.parseDefineSyntax(group);
        case 30 /* SYNTAX_RULES */:
          throw new UnexpectedFormError(
            this.source,
            firstElement.pos,
            firstElement
          );
        // Scm-slang misc
        case 27 /* IMPORT */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseImport(group);
        case 28 /* EXPORT */:
          this.validateChapter(firstElement, BASIC_CHAPTER);
          return this.parseExport(group);
        case 32 /* VECTOR */:
          this.validateChapter(firstElement, VECTOR_CHAPTER);
          return this.parseAffectorGroup(group);
        default:
          return this.parseApplication(group);
      }
    }
    return this.parseApplication(group);
  }
  /**
   * We are parsing a list/dotted list.
   */
  parseQuotedGroup(group) {
    if (group.length() === 0) {
      return new Atomic.Nil(group.location);
    }
    if (group.length() === 1) {
      const elem = [this.parseExpression(group.unwrap()[0])];
      return new Extended.List(group.location, elem);
    }
    const groupElements = group.unwrap();
    const [listElements, cdrElement] = this.destructureList(groupElements);
    return new Extended.List(group.location, listElements, cdrElement);
  }
  // _____________________CHAPTER 1_____________________
  /**
   * Parse a lambda expression.
   * @param group
   * @returns
   */
  parseLambda(group) {
    if (group.length() < 3) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(lambda (<identifier>* . <rest-identifier>?) <body>+) | (lambda <rest-identifer> <body>+)"
      );
    }
    const elements = group.unwrap();
    const formals = elements[1];
    const body = elements.slice(2);
    let convertedFormals = [];
    let convertedRest = void 0;
    if (isToken(formals)) {
      if (formals.type !== 6 /* IDENTIFIER */) {
        throw new ExpectedFormError(
          this.source,
          formals.pos,
          formals,
          "<rest-identifier>"
        );
      }
      convertedRest = new Atomic.Identifier(
        this.toLocation(formals),
        formals.lexeme
      );
    } else {
      const formalsElements = formals.unwrap();
      [convertedFormals, convertedRest] = this.destructureList(
        formalsElements,
        // pass in a verifier that checks if the elements are identifiers
        (formal) => {
          if (!isToken(formal)) {
            throw new ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
          if (formal.type !== 6 /* IDENTIFIER */) {
            throw new ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
        }
      );
    }
    const convertedBody = body.map(
      this.parseExpression.bind(this)
    );
    if (convertedBody.length < 1) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(lambda ... <body>+)"
      );
    }
    if (convertedBody.length === 1) {
      return new Atomic.Lambda(
        group.location,
        convertedBody[0],
        convertedFormals,
        convertedRest
      );
    }
    const newLocation = convertedBody.at(0).location.merge(convertedBody.at(-1).location);
    const bodySequence = new Atomic.Sequence(newLocation, convertedBody);
    return new Atomic.Lambda(
      group.location,
      bodySequence,
      convertedFormals,
      convertedRest
    );
  }
  /**
   * Parse a define expression.
   * @param group
   * @returns
   */
  parseDefinition(group) {
    if (group.length() < 3) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define <identifier> <expr>) | (define (<identifier> <formals>) <body>+)"
      );
    }
    const elements = group.unwrap();
    const identifier = elements[1];
    const expr = elements.slice(2);
    let convertedIdentifier;
    let convertedFormals = [];
    let convertedRest = void 0;
    let isFunctionDefinition = false;
    if (isGroup(identifier)) {
      isFunctionDefinition = true;
      const identifierElements = identifier.unwrap();
      const functionName = identifierElements[0];
      const formals = identifierElements.splice(1);
      if (!isToken(functionName)) {
        throw new ExpectedFormError(
          this.source,
          functionName.location.start,
          functionName,
          "<identifier>"
        );
      }
      if (functionName.type !== 6 /* IDENTIFIER */) {
        throw new ExpectedFormError(
          this.source,
          functionName.pos,
          functionName,
          "<identifier>"
        );
      }
      convertedIdentifier = new Atomic.Identifier(
        this.toLocation(functionName),
        functionName.lexeme
      );
      [convertedFormals, convertedRest] = this.destructureList(
        formals,
        (formal) => {
          if (!isToken(formal)) {
            throw new ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
          if (formal.type !== 6 /* IDENTIFIER */) {
            throw new ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
        }
      );
    } else if (identifier.type !== 6 /* IDENTIFIER */) {
      throw new ExpectedFormError(
        this.source,
        identifier.pos,
        identifier,
        "<identifier>"
      );
    } else {
      convertedIdentifier = new Atomic.Identifier(
        this.toLocation(identifier),
        identifier.lexeme
      );
      isFunctionDefinition = false;
    }
    if (expr.length < 1) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define ... <body>+)"
      );
    }
    if (isFunctionDefinition) {
      const convertedBody = expr.map(
        this.parseExpression.bind(this)
      );
      if (convertedBody.length === 1) {
        return new Extended.FunctionDefinition(
          group.location,
          convertedIdentifier,
          convertedBody[0],
          convertedFormals,
          convertedRest
        );
      }
      const newLocation = convertedBody.at(0).location.merge(convertedBody.at(-1).location);
      const bodySequence = new Atomic.Sequence(newLocation, convertedBody);
      return new Extended.FunctionDefinition(
        group.location,
        convertedIdentifier,
        bodySequence,
        convertedFormals,
        convertedRest
      );
    }
    if (expr.length > 1) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define <identifier> <expr>)"
      );
    }
    const convertedExpr = this.parseExpression(expr[0]);
    return new Atomic.Definition(
      group.location,
      convertedIdentifier,
      convertedExpr
    );
  }
  /**
   * Parse a conditional expression.
   * @param group
   * @returns
   */
  parseConditional(group) {
    if (group.length() < 3 || group.length() > 4) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(if <pred> <cons> <alt>?)"
      );
    }
    const elements = group.unwrap();
    const test = elements[1];
    const consequent = elements[2];
    const alternate = group.length() > 3 ? elements[3] : void 0;
    const convertedTest = this.parseExpression(test);
    const convertedConsequent = this.parseExpression(consequent);
    const convertedAlternate = alternate ? this.parseExpression(alternate) : new Atomic.Identifier(group.location, "undefined");
    return new Atomic.Conditional(
      group.location,
      convertedTest,
      convertedConsequent,
      convertedAlternate
    );
  }
  /**
   * Parse an application expression.
   */
  parseApplication(group) {
    if (group.length() < 1) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(<func> <args>*)"
      );
    }
    const elements = group.unwrap();
    const operator = elements[0];
    const operands = elements.splice(1);
    const convertedOperator = this.parseExpression(operator);
    const convertedOperands = [];
    for (const operand of operands) {
      convertedOperands.push(this.parseExpression(operand));
    }
    return new Atomic.Application(
      group.location,
      convertedOperator,
      convertedOperands
    );
  }
  /**
   * Parse a let expression.
   * @param group
   * @returns
   */
  parseLet(group) {
    if (this.chapter >= MACRO_CHAPTER) {
      const groupItems = group.unwrap().slice(1);
      groupItems.forEach((item) => {
        this.parseExpression(item);
      });
      return new Extended.Let(
        group.location,
        [],
        [],
        new Atomic.Identifier(group.location, "undefined")
      );
    }
    if (group.length() < 3) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(let ((<identifier> <value>)*) <body>+)"
      );
    }
    const elements = group.unwrap();
    const bindings = elements[1];
    const body = elements.slice(2);
    if (!isGroup(bindings)) {
      throw new ExpectedFormError(
        this.source,
        bindings.pos,
        bindings,
        "((<identifier> <value>)*)"
      );
    }
    const convertedIdentifiers = [];
    const convertedValues = [];
    const bindingElements = bindings.unwrap();
    for (const bindingElement of bindingElements) {
      if (!isGroup(bindingElement)) {
        throw new ExpectedFormError(
          this.source,
          bindingElement.pos,
          bindingElement,
          "(<identifier> <value>)"
        );
      }
      if (bindingElement.length() !== 2) {
        throw new ExpectedFormError(
          this.source,
          bindingElement.location.start,
          bindingElement,
          "(<identifier> <value>)"
        );
      }
      const [identifier, value] = bindingElement.unwrap();
      if (!isToken(identifier)) {
        throw new ExpectedFormError(
          this.source,
          identifier.location.start,
          identifier,
          "<identifier>"
        );
      }
      if (identifier.type !== 6 /* IDENTIFIER */) {
        throw new ExpectedFormError(
          this.source,
          identifier.pos,
          identifier,
          "<identifier>"
        );
      }
      convertedIdentifiers.push(
        new Atomic.Identifier(this.toLocation(identifier), identifier.lexeme)
      );
      convertedValues.push(this.parseExpression(value));
    }
    const convertedBody = body.map(
      this.parseExpression.bind(this)
    );
    if (convertedBody.length < 1) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(let ... <body>+)"
      );
    }
    if (convertedBody.length === 1) {
      return new Extended.Let(
        group.location,
        convertedIdentifiers,
        convertedValues,
        convertedBody[0]
      );
    }
    const newLocation = convertedBody.at(0).location.merge(convertedBody.at(-1).location);
    const bodySequence = new Atomic.Sequence(newLocation, convertedBody);
    return new Extended.Let(
      group.location,
      convertedIdentifiers,
      convertedValues,
      bodySequence
    );
  }
  /**
   * Parse an extended cond expression.
   * @param group
   * @returns
   */
  parseExtendedCond(group) {
    if (this.chapter >= MACRO_CHAPTER) {
      const groupItems = group.unwrap().slice(1);
      groupItems.forEach((item) => {
        this.parseExpression(item);
      });
      return new Extended.Cond(
        group.location,
        [],
        [],
        new Atomic.Identifier(group.location, "undefined")
      );
    }
    if (group.length() < 2) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(cond (<pred> <body>*)* (else <val>)?)"
      );
    }
    const elements = group.unwrap();
    const clauses = elements.splice(1);
    const lastClause = clauses.pop();
    const convertedClauses = [];
    const convertedConsequents = [];
    for (const clause of clauses) {
      if (!isGroup(clause)) {
        throw new ExpectedFormError(
          this.source,
          clause.pos,
          clause,
          "(<pred> <body>*)"
        );
      }
      if (clause.length() < 1) {
        throw new ExpectedFormError(
          this.source,
          clause.firstToken().pos,
          clause.firstToken(),
          "(<pred> <body>*)"
        );
      }
      const [test2, ...consequent2] = clause.unwrap();
      if (isToken(test2) && test2.type === 13 /* ELSE */) {
        throw new ExpectedFormError(
          this.source,
          test2.pos,
          test2,
          "<predicate>"
        );
      }
      const convertedTest = this.parseExpression(test2);
      const consequentExpressions2 = consequent2.map(
        this.parseExpression.bind(this)
      );
      const consequentLocation2 = consequent2.length < 1 ? convertedTest.location : consequentExpressions2.at(0).location.merge(consequentExpressions2.at(-1).location);
      const convertedConsequent = consequent2.length < 1 ? convertedTest : consequent2.length < 2 ? consequentExpressions2[0] : new Atomic.Sequence(consequentLocation2, consequentExpressions2);
      convertedClauses.push(convertedTest);
      convertedConsequents.push(convertedConsequent);
    }
    if (!isGroup(lastClause)) {
      throw new ExpectedFormError(
        this.source,
        lastClause.pos,
        lastClause,
        "(<pred> <body>+) | (else <val>)"
      );
    }
    if (lastClause.length() < 2) {
      throw new ExpectedFormError(
        this.source,
        lastClause.firstToken().pos,
        lastClause.firstToken(),
        "(<pred> <body>+) | (else <val>)"
      );
    }
    const [test, ...consequent] = lastClause.unwrap();
    let isElse = false;
    if (isToken(test) && test.type === 13 /* ELSE */) {
      isElse = true;
      if (consequent.length !== 1) {
        throw new ExpectedFormError(
          this.source,
          lastClause.location.start,
          lastClause,
          "(else <val>)"
        );
      }
    }
    if (consequent.length < 1) {
      throw new ExpectedFormError(
        this.source,
        lastClause.location.start,
        lastClause,
        "(<pred> <body>+)"
      );
    }
    const consequentExpressions = consequent.map(
      this.parseExpression.bind(this)
    );
    const consequentLocation = consequentExpressions.at(0).location.merge(consequentExpressions.at(-1).location);
    const lastConsequent = consequent.length === 1 ? consequentExpressions[0] : new Atomic.Sequence(consequentLocation, consequentExpressions);
    if (isElse) {
      return new Extended.Cond(
        group.location,
        convertedClauses,
        convertedConsequents,
        lastConsequent
      );
    }
    const lastTest = this.parseExpression(test);
    convertedClauses.push(lastTest);
    convertedConsequents.push(lastConsequent);
    return new Extended.Cond(
      group.location,
      convertedClauses,
      convertedConsequents
    );
  }
  // _____________________CHAPTER 3_____________________
  /**
   * Parse a reassignment expression.
   * @param group
   * @returns
   */
  parseSet(group) {
    if (group.length() !== 3) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(set! <identifier> <expr>)"
      );
    }
    const elements = group.unwrap();
    const identifier = elements[1];
    const expr = elements[2];
    if (isGroup(identifier)) {
      throw new ExpectedFormError(
        this.source,
        identifier.location.start,
        identifier,
        "<identifier>"
      );
    }
    if (identifier.type !== 6 /* IDENTIFIER */) {
      throw new ExpectedFormError(
        this.source,
        identifier.pos,
        identifier,
        "<identifier>"
      );
    }
    const convertedIdentifier = new Atomic.Identifier(
      this.toLocation(identifier),
      identifier.lexeme
    );
    const convertedExpr = this.parseExpression(expr);
    return new Atomic.Reassignment(
      group.location,
      convertedIdentifier,
      convertedExpr
    );
  }
  /**
   * Parse a begin expression.
   * @param group
   * @returns
   */
  parseBegin(group) {
    if (group.length() < 2) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(begin <body>+)"
      );
    }
    const sequence = group.unwrap();
    const sequenceElements = sequence.slice(1);
    const convertedExpressions = [];
    for (const sequenceElement of sequenceElements) {
      convertedExpressions.push(this.parseExpression(sequenceElement));
    }
    return new Extended.Begin(group.location, convertedExpressions);
  }
  /**
   * Parse a delay expression.
   * @param group
   * @returns
   */
  parseDelay(group) {
    if (this.chapter >= MACRO_CHAPTER) {
      const groupItems = group.unwrap().slice(1);
      groupItems.forEach((item) => {
        this.parseExpression(item);
      });
      return new Extended.Delay(
        group.location,
        new Atomic.Identifier(group.location, "undefined")
      );
    }
    if (group.length() !== 2) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(delay <expr>)"
      );
    }
    const elements = group.unwrap();
    const expr = elements[1];
    const convertedExpr = this.parseExpression(expr);
    return new Extended.Delay(group.location, convertedExpr);
  }
  // _____________________CHAPTER 3_____________________
  /**
   * Parse a define-syntax expression.
   * @param group
   * @returns nothing, this is for verification only.
   */
  parseDefineSyntax(group) {
    if (group.length() !== 3) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define-syntax <identifier> <transformer>)"
      );
    }
    const elements = group.unwrap();
    const identifier = elements[1];
    const transformer = elements[2];
    this.quoteMode = 1 /* QUOTE */;
    const convertedIdentifier = this.parseExpression(
      identifier
    );
    this.quoteMode = 0 /* NONE */;
    if (!(convertedIdentifier instanceof Atomic.Symbol)) {
      throw new ExpectedFormError(
        this.source,
        convertedIdentifier.location.start,
        identifier,
        "<identifier>"
      );
    }
    if (!isGroup(transformer)) {
      throw new ExpectedFormError(
        this.source,
        transformer.pos,
        transformer,
        "<transformer>"
      );
    }
    if (transformer.length() < 2) {
      throw new ExpectedFormError(
        this.source,
        transformer.firstToken().pos,
        transformer,
        "(syntax-rules ...)"
      );
    }
    const transformerToken = transformer.unwrap()[0];
    if (!isToken(transformer.unwrap()[0])) {
      throw new ExpectedFormError(
        this.source,
        transformer.firstToken().pos,
        transformerToken,
        "syntax-rules"
      );
    }
    if (transformerToken.type !== 30 /* SYNTAX_RULES */) {
      throw new ExpectedFormError(
        this.source,
        transformerToken.pos,
        transformerToken,
        "syntax-rules"
      );
    }
    const convertedTransformer = this.parseSyntaxRules(
      transformer
    );
    return new Atomic.DefineSyntax(
      group.location,
      convertedIdentifier,
      convertedTransformer
    );
  }
  /**
   * Helper function to verify the validity of a pattern.
   * @param pattern
   * @returns validity of the pattern
   */
  isValidPattern(pattern) {
    if (pattern instanceof Extended.List) {
      const isProper = pattern.terminator === void 0;
      if (isProper) {
        const ellipsisCount = pattern.elements.filter(
          (item) => item instanceof Atomic.Symbol && item.value === "..."
        ).length;
        if (ellipsisCount > 1) {
          return false;
        }
        const ellipsisIndex = pattern.elements.findIndex(
          (item) => item instanceof Atomic.Symbol && item.value === "..."
        );
        if (ellipsisIndex != -1) {
          if (ellipsisIndex === 0) {
            return false;
          }
        }
        for (const element of pattern.elements) {
          if (!this.isValidPattern(element)) {
            return false;
          }
        }
        return true;
      } else {
        const ellipsisCount = pattern.elements.filter(
          (item) => item instanceof Atomic.Symbol && item.value === "..."
        ).length;
        if (ellipsisCount > 1) {
          return false;
        }
        const ellipsisIndex = pattern.elements.findIndex(
          (item) => item instanceof Atomic.Symbol && item.value === "..."
        );
        if (ellipsisIndex != -1) {
          if (ellipsisIndex === 0) {
            return false;
          }
          if (ellipsisIndex === pattern.elements.length - 1) {
            return false;
          }
        }
        for (const element of pattern.elements) {
          if (!this.isValidPattern(element)) {
            return false;
          }
        }
        return this.isValidPattern(pattern.terminator);
      }
    } else if (pattern instanceof Atomic.Symbol || pattern instanceof Atomic.BooleanLiteral || pattern instanceof Atomic.NumericLiteral || pattern instanceof Atomic.StringLiteral || pattern instanceof Atomic.Nil) {
      return true;
    } else {
      return false;
    }
  }
  /**
   * Helper function to verify the validity of a template.
   * @param template
   * @returns validity of the template
   */
  isValidTemplate(template) {
    if (template instanceof Extended.List) {
      const isProper = template.terminator === void 0;
      if (isProper) {
        if (template.elements.length === 0) {
          return false;
        }
        if (template.elements.length === 2 && template.elements[0] instanceof Atomic.Symbol && template.elements[0].value === "...") {
          return this.isValidTemplate(template.elements[1]);
        }
        let ellipsisWorksOnLastElement = false;
        for (let i = 0; i < template.elements.length; i++) {
          const element = template.elements[i];
          if (element instanceof Atomic.Symbol && element.value === "...") {
            if (ellipsisWorksOnLastElement) {
              ellipsisWorksOnLastElement = false;
              continue;
            }
            return false;
          } else {
            if (!this.isValidTemplate(element)) {
              return false;
            }
            ellipsisWorksOnLastElement = true;
          }
        }
        return true;
      } else {
        if (template.elements.length === 0) {
          return false;
        }
        let ellipsisWorksOnLastElement = false;
        for (let i = 0; i < template.elements.length; i++) {
          const element = template.elements[i];
          if (element instanceof Atomic.Symbol && element.value === "...") {
            if (ellipsisWorksOnLastElement) {
              ellipsisWorksOnLastElement = false;
              continue;
            }
            return false;
          } else {
            if (!this.isValidTemplate(element)) {
              return false;
            }
            ellipsisWorksOnLastElement = true;
          }
        }
        return this.isValidTemplate(template.terminator);
      }
    } else if (template instanceof Atomic.Symbol || template instanceof Atomic.BooleanLiteral || template instanceof Atomic.NumericLiteral || template instanceof Atomic.StringLiteral || template instanceof Atomic.Nil) {
      return true;
    } else {
      return false;
    }
  }
  /**
   * Parse a syntax-rules expression.
   * @param group
   * @returns nothing, this is for verification only.
   */
  parseSyntaxRules(group) {
    if (group.length() < 3) {
      throw new ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(syntax-rules (<literal>*) <syntax-rule>+)"
      );
    }
    const elements = group.unwrap();
    const literals = elements[1];
    const rules = elements.slice(2);
    const finalLiterals = [];
    if (!isGroup(literals)) {
      throw new ExpectedFormError(
        this.source,
        literals.pos,
        literals,
        "(<literal>*)"
      );
    }
    this.quoteMode = 1 /* QUOTE */;
    for (const literal of literals.unwrap()) {
      if (!isToken(literal)) {
        throw new ExpectedFormError(
          this.source,
          literal.location.start,
          literal,
          "<literal>"
        );
      }
      const convertedLiteral = this.parseExpression(literal);
      if (!(convertedLiteral instanceof Atomic.Symbol)) {
        throw new ExpectedFormError(
          this.source,
          literal.pos,
          literal,
          "<literal>"
        );
      }
      finalLiterals.push(convertedLiteral);
    }
    const finalRules = [];
    for (const rule of rules) {
      if (!isGroup(rule)) {
        throw new ExpectedFormError(
          this.source,
          rule.pos,
          rule,
          "(<pattern> <template>)"
        );
      }
      if (rule.length() !== 2) {
        throw new ExpectedFormError(
          this.source,
          rule.location.start,
          rule,
          "(<pattern> <template>)"
        );
      }
      const [pattern, template] = rule.unwrap();
      const convertedPattern = this.parseExpression(pattern);
      const convertedTemplate = this.parseExpression(template);
      if (!this.isValidPattern(convertedPattern)) {
        throw new ExpectedFormError(
          this.source,
          convertedPattern.location.start,
          pattern,
          "<symbol> | <literal> | (<pattern>+) | (<pattern>+ ... <pattern>*) | (<pattern>+ ... <pattern>+ . <pattern>)"
        );
      }
      if (!this.isValidTemplate(convertedTemplate)) {
        throw new ExpectedFormError(
          this.source,
          convertedTemplate.location.start,
          template,
          "<symbol> | <literal> | (<element>+) | (<element>+ . <template>) | (... <template>)"
        );
      }
      finalRules.push([convertedPattern, convertedTemplate]);
    }
    this.quoteMode = 0 /* NONE */;
    return new Atomic.SyntaxRules(group.location, finalLiterals, finalRules);
  }
  // ___________________MISCELLANEOUS___________________
  /**
   * Parse an import expression.
   * @param group
   * @returns
   */
  parseImport(group) {
    if (group.length() !== 3) {
      throw new ExpectedFormError(
        this.source,
        group.firstToken().pos,
        group.firstToken(),
        '(import "<source>" (<identifier>*))'
      );
    }
    const elements = group.unwrap();
    const source = elements[1];
    const identifiers = elements[2];
    if (!isToken(source)) {
      throw new ExpectedFormError(
        this.source,
        source.location.start,
        source,
        '"<source>"'
      );
    }
    if (source.type !== 9 /* STRING */) {
      throw new ExpectedFormError(
        this.source,
        source.pos,
        source,
        '"<source>"'
      );
    }
    if (!isGroup(identifiers)) {
      throw new ExpectedFormError(
        this.source,
        identifiers.pos,
        identifiers,
        "(<identifier>*)"
      );
    }
    const identifierElements = identifiers.unwrap();
    const convertedIdentifiers = [];
    for (const identifierElement of identifierElements) {
      if (!isToken(identifierElement)) {
        throw new ExpectedFormError(
          this.source,
          identifierElement.location.start,
          identifierElement,
          "<identifier>"
        );
      }
      if (identifierElement.type !== 6 /* IDENTIFIER */) {
        throw new ExpectedFormError(
          this.source,
          identifierElement.pos,
          identifierElement,
          "<identifier>"
        );
      }
      convertedIdentifiers.push(
        new Atomic.Identifier(
          this.toLocation(identifierElement),
          identifierElement.lexeme
        )
      );
    }
    const convertedSource = new Atomic.StringLiteral(
      this.toLocation(source),
      source.literal
    );
    return new Atomic.Import(
      group.location,
      convertedSource,
      convertedIdentifiers
    );
  }
  /**
   * Parse an export expression.
   * @param group
   * @returns
   */
  parseExport(group) {
    if (group.length() !== 2) {
      throw new ExpectedFormError(
        this.source,
        group.firstToken().pos,
        group.firstToken(),
        "(export (<definition>))"
      );
    }
    const elements = group.unwrap();
    const definition = elements[1];
    if (!isGroup(definition)) {
      throw new ExpectedFormError(
        this.source,
        definition.pos,
        definition,
        "(<definition>)"
      );
    }
    const convertedDefinition = this.parseExpression(definition);
    if (!(convertedDefinition instanceof Atomic.Definition || convertedDefinition instanceof Extended.FunctionDefinition)) {
      throw new ExpectedFormError(
        this.source,
        definition.location.start,
        definition,
        "(<definition>)"
      );
    }
    return new Atomic.Export(group.location, convertedDefinition);
  }
  /**
   * Parses a vector expression
   */
  parseVector(group) {
    const elements = group.unwrap()[1];
    const convertedElements = elements.unwrap().map(this.parseExpression.bind(this));
    return new Atomic.Vector(group.location, convertedElements);
  }
  // ___________________________________________________
  /** Parses a sequence of tokens into an AST.
   *
   * @param group A group of tokens.
   * @returns An AST.
   */
  parse(reparseAsSexpr = false) {
    if (reparseAsSexpr) {
      this.quoteMode = 1 /* QUOTE */;
      this.current = 0;
    }
    const topElements = [];
    while (!this.isAtEnd()) {
      if (this.peek().type === 33 /* EOF */) {
        break;
      }
      const currentElement = this.grouping();
      if (!currentElement) {
        continue;
      }
      const convertedElement = this.parseExpression(currentElement);
      topElements.push(convertedElement);
    }
    if (this.chapter >= MACRO_CHAPTER && !reparseAsSexpr) {
      const importElements = topElements.filter(
        (e) => e instanceof Atomic.Import
      );
      const sexprElements = this.parse(true);
      const restElements = sexprElements.filter(
        (e) => !(e instanceof Extended.List && e.elements && e.elements[0] instanceof Atomic.Symbol && e.elements[0].value === "import")
      );
      return [...importElements, ...restElements];
    }
    return topElements;
  }
};

// src/pie_interpreter/utils/locations.ts
var SourceLocation = class {
  constructor(source, startLine, startColumn, endLine, endColumn) {
    this.source = source;
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
};
var Syntax = class {
  constructor(start, end, source) {
    this.start = start;
    this.end = end;
    this.source = source;
  }
};
var Location2 = class {
  constructor(syntax, forInfo) {
    this.syntax = syntax;
    this.forInfo = forInfo;
  }
  locationToSrcLoc() {
    return new SourceLocation(
      this.syntax.source,
      this.syntax.start.line,
      this.syntax.start.column,
      this.syntax.end.line,
      this.syntax.end.column
    );
  }
  toString() {
    return `${this.syntax.source}:${this.syntax.start.line}:${this.syntax.start.column}`;
  }
};
function notForInfo(loc) {
  return new Location2(loc.syntax, false);
}

// src/pie_interpreter/tactics/proofstate.ts
var Goal = class _Goal {
  constructor(id, type, context, renaming, term) {
    this.id = id;
    this.type = type;
    this.context = context;
    this.renaming = renaming;
    this.term = term;
  }
  clone(modifications = {}) {
    return new _Goal(
      modifications.id ?? this.id,
      modifications.type ?? this.type,
      modifications.context ?? new Map(this.context),
      modifications.renaming ?? new Map(this.renaming),
      modifications.term ?? this.term
    );
  }
  addHypothesis(name, type) {
    const freename = fresh(this.context, name);
    extendContext(this.context, freename, new Claim(type));
  }
  getVariableType(name) {
    const binder = this.context.get(name);
    return binder?.type;
  }
  prettyPrintWithContext() {
    const contextStr = Array.from(this.context.entries()).map(([name, binder]) => `${name} : ${binder.type.readBackType(this.context).prettyPrint()}`).join("\n  ");
    const goalStr = this.type.readBackType(this.context).prettyPrint();
    return contextStr ? `Context:
  ${contextStr}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Goal: ${goalStr}` : `Goal: ${goalStr}`;
  }
  toSerializable(isComplete, isCurrent) {
    const contextEntries = Array.from(this.context.entries()).map(([name, binder]) => ({
      name,
      type: binder.type.readBackType(this.context).prettyPrint()
    }));
    return {
      id: this.id,
      type: this.type.readBackType(this.context).prettyPrint(),
      contextEntries,
      isComplete,
      isCurrent
    };
  }
};
var GoalNode = class {
  // Tactic that directly solved this goal (for leaf nodes)
  constructor(goal) {
    this.goal = goal;
    this.children = [];
    this.parent = null;
    this.isComplete = false;
    this.childFocusIndex = -1;
  }
  addChildren(children) {
    children.forEach((child) => {
      child.parent = this;
    });
    this.children = children;
  }
  findById(goalId) {
    if (this.goal.id === goalId) {
      return this;
    }
    for (const child of this.children) {
      const found = child.findById(goalId);
      if (found) return found;
    }
    return null;
  }
  toSerializable(currentGoalId) {
    const isCurrent = this.goal.id === currentGoalId;
    return {
      goal: this.goal.toSerializable(this.isComplete, isCurrent),
      children: this.children.map((child) => child.toSerializable(currentGoalId)),
      appliedTactic: this.appliedTactic,
      completedBy: this.completedBy
    };
  }
};
var ProofState = class _ProofState {
  constructor(location, goalTree) {
    this.location = location;
    this.goalTree = goalTree;
    this.proofHistory = [];
    this.goalIdCounter = 0;
    this.currentGoal = this.goalTree;
  }
  static initialize(globalContext, theorem, location) {
    const rootGoal = new Goal(
      "goal_0",
      theorem,
      new Map(globalContext),
      /* @__PURE__ */ new Map()
    );
    const proofstate = new _ProofState(location, new GoalNode(rootGoal));
    proofstate.currentGoal = proofstate.goalTree;
    return proofstate;
  }
  generateGoalId() {
    return `goal_${++this.goalIdCounter}`;
  }
  isComplete() {
    return this.goalTree.isComplete;
  }
  getCurrentGoal() {
    if (this.currentGoal === null) {
      throw new Error("No current goal available.");
    }
    return new go(this.currentGoal.goal);
  }
  visualizeTree() {
    return this.visualizeNode(this.goalTree, "", true);
  }
  visualizeNode(node, prefix, isLast) {
    const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const status = node.isComplete ? "\u2713" : node === this.currentGoal ? "\u2192" : "\u25CB";
    const goalInfo = `${status} ${node.goal.id}`;
    let result = prefix + connector + goalInfo + "\n";
    const childPrefix = prefix + (isLast ? "    " : "\u2502   ");
    for (let i = 0; i < node.children.length; i++) {
      const isLastChild = i === node.children.length - 1;
      result += this.visualizeNode(node.children[i], childPrefix, isLastChild);
    }
    return result;
  }
  addGoal(goals) {
    this.currentGoal.addChildren(goals);
    this.currentGoal.childFocusIndex = 0;
    this.currentGoal = goals[0];
  }
  nextGoal() {
    if (this.currentGoal.parent === null) {
      return true;
    }
    const cur_parent = this.currentGoal.parent;
    const nextGoal = this.nextGoalAux(cur_parent);
    if (nextGoal === null) {
      return true;
    } else {
      this.currentGoal = nextGoal;
      return false;
    }
  }
  nextGoalAux(curParent) {
    if (curParent.childFocusIndex === -1 || curParent.childFocusIndex >= curParent.children.length - 1) {
      const allChildrenComplete = curParent.children.length === 0 || curParent.children.every((child) => child.isComplete);
      if (allChildrenComplete) {
        curParent.isComplete = true;
      }
      if (curParent.parent === null) {
        return null;
      } else {
        return this.nextGoalAux(curParent.parent);
      }
    } else {
      curParent.childFocusIndex += 1;
      return curParent.children[curParent.childFocusIndex];
    }
  }
  previousGoal() {
    if (this.currentGoal.parent === null) {
      throw new Error("No previous goal available at the root level.");
    }
    const prevGoal = this.PreviousGoalAux(this.currentGoal);
    if (prevGoal === null) {
      throw new Error("No previous goal found.");
    } else {
      this.currentGoal = prevGoal;
    }
  }
  PreviousGoalAux(curParent) {
    if (curParent.childFocusIndex === 0) {
      return curParent;
    } else {
      let isBottom = false;
      let curNode = curParent.children[curParent.childFocusIndex - 1];
      while (!isBottom) {
        if (curNode.childFocusINdex === -1) {
          isBottom = true;
          return curNode;
        } else {
          curNode = curNode.children[curNode.childFocusIndex];
        }
      }
    }
    return null;
  }
  getProofTreeData() {
    const currentGoalId = this.currentGoal ? this.currentGoal.goal.id : null;
    return {
      root: this.goalTree.toSerializable(currentGoalId),
      isComplete: this.isComplete(),
      currentGoalId
    };
  }
};

// src/pie_interpreter/tactics/proofmanager.ts
var ProofManager = class {
  constructor() {
    this.currentState = null;
  }
  startProof(name, context, location) {
    const claim = context.get(name);
    if (!(claim instanceof Claim)) {
      return new stop(location, new Message([`${name} is not a valid type or has already been proved`]));
    }
    this.currentState = ProofState.initialize(context, claim.type, location);
    return new go(`Started proof of ${name}
Current goal: 
${claim.type.readBackType(context).prettyPrint()}`);
  }
  applyTactic(tactic) {
    if (!this.currentState) {
      return new stop(tactic.location, new Message([`No proof has been initialized`]));
    }
    const previousGoalNode = this.currentState.currentGoal;
    const newStateResult = tactic.apply(this.currentState);
    if (newStateResult instanceof stop) {
      return newStateResult;
    }
    this.currentState = newStateResult.result;
    if (previousGoalNode.children.length > 0) {
      previousGoalNode.appliedTactic = tactic.toString();
    }
    let response = `
Applied tactic: ${tactic}`;
    const currentGoal = this.currentState.getCurrentGoal();
    if (this.currentState.isComplete()) {
      response += "\nAll goals have been solved!";
    } else {
      const curGoal = currentGoal.result;
      response += `
Current goal: 
` + curGoal.type.readBackType(curGoal.context).prettyPrint();
    }
    return new go(response);
  }
  getProofTreeData() {
    if (!this.currentState) {
      return null;
    }
    return this.currentState.getProofTreeData();
  }
};

// src/pie_interpreter/utils/context.ts
function extendContext(ctx, name, binder) {
  return new Map([...ctx, [name, binder]]);
}
function valInContext(ctx, expr) {
  return expr.valOf(contextToEnvironment(ctx));
}
function readBackContext(ctx) {
  const result = /* @__PURE__ */ new Map();
  for (const [x, binder] of ctx) {
    if (binder instanceof Free) {
      result.set(x, ["free", binder.type.readBackType(ctx)]);
    } else if (binder instanceof Define) {
      result.set(
        x,
        [
          "def",
          binder.type.readBackType(ctx),
          readBack(ctx, binder.type, binder.value)
        ]
      );
    } else if (binder instanceof Claim) {
      result.set(
        x,
        ["claim", binder.type.readBackType(ctx)]
      );
    }
  }
  return result;
}
function nameNotUsed(ctx, where, name) {
  if (ctx.has(name)) {
    return new stop(
      where,
      new Message([`The name "${name}" is already in use in the context.`])
    );
  } else return new go(true);
}
function getClaim(ctx, where, name) {
  for (const [x, binder] of ctx) {
    if (x === name) {
      if (binder instanceof Define) {
        return new stop(where, new Message([`The name "${name}" is already defined.`]));
      } else if (binder instanceof Claim) {
        return new go(binder.type);
      }
    }
  }
  return new stop(where, new Message([`No claim: ${name}`]));
}
function addClaimToContext(ctx, fun, funLoc, type) {
  const typeOut = new PerhapsM("typeOut");
  return goOn(
    [
      [new PerhapsM("_"), () => nameNotUsed(ctx, funLoc, fun)],
      [typeOut, () => type.isType(ctx, /* @__PURE__ */ new Map())]
    ],
    () => new go(
      extendContext(
        ctx,
        fun,
        new Claim(valInContext(ctx, typeOut.value))
      )
    )
  );
}
function removeClaimFromContext(ctx, name) {
  ctx.delete(name);
  return ctx;
}
function addDefineToContext(ctx, fun, funLoc, expr) {
  const typeOut = new PerhapsM("typeOut");
  const exprOut = new PerhapsM("exprOut");
  return goOn(
    [
      [typeOut, () => getClaim(ctx, funLoc, fun)],
      [
        exprOut,
        () => expr.check(
          ctx,
          /* @__PURE__ */ new Map(),
          typeOut.value
        )
      ]
    ],
    () => new go(
      bindVal(
        removeClaimFromContext(ctx, fun),
        fun,
        typeOut.value,
        valInContext(ctx, exprOut.value)
      )
    )
  );
}
function addDefineTacticallyToContext(ctx, name, location, tactics) {
  const proofManager = new ProofManager();
  let message = "";
  const startResult = proofManager.startProof(name, ctx, location);
  if (startResult instanceof stop) {
    return startResult;
  }
  message += startResult.result + "\n";
  for (const tactic of tactics) {
    const tacticResult = proofManager.applyTactic(tactic);
    if (tacticResult instanceof stop) {
      return tacticResult;
    }
    message += tacticResult.result;
  }
  if (!proofManager.currentState || !proofManager.currentState.isComplete()) {
    const currentGoal = proofManager.currentState?.getCurrentGoal();
    let goalInfo = "";
    if (currentGoal instanceof go) {
      const goal = currentGoal.result;
      goalInfo = `

${goal.prettyPrintWithContext()}`;
    }
    const proofTree2 = proofManager.getProofTreeData() ?? void 0;
    return new go({
      context: ctx,
      message: message + `

Proof incomplete. Not all goals have been solved.${goalInfo}`,
      proofTree: proofTree2,
      isIncomplete: true
    });
  }
  const claim = ctx.get(name);
  if (!(claim instanceof Claim)) {
    return new stop(location, new Message([`${name} is not a valid claim`]));
  }
  const type = claim.type;
  const goalTree = proofManager.currentState?.goalTree;
  const proofTerm = goalTree?.goal.term;
  const proofTree = proofManager.getProofTreeData() ?? void 0;
  if (proofTerm) {
    const proofValue = valInContext(ctx, proofTerm);
    const newCtx = bindVal(removeClaimFromContext(ctx, name), name, type, proofValue);
    return new go({ context: newCtx, message, proofTree });
  } else {
    return new go({ context: ctx, message: message + `
Warning: Proof term extraction not yet implemented for '${name}'`, proofTree });
  }
}
function contextToEnvironment(ctx) {
  if (ctx.size === 0) {
    return /* @__PURE__ */ new Map();
  }
  const bindings = ctx.entries();
  const env = /* @__PURE__ */ new Map();
  for (const [name, binder] of bindings) {
    if (binder instanceof Define) {
      env.set(name, binder.value);
    } else if (binder instanceof Free) {
      env.set(name, new Neutral(binder.type, new Variable(name)));
    } else if (binder instanceof InductiveDatatypeBinder) {
      env.set(name, binder.type);
    }
  }
  return env;
}
function getInductiveType(ctx, where, name) {
  for (const [n, binder] of ctx) {
    if (binder instanceof InductiveDatatypeBinder && n === name) {
      return new go(binder);
    }
  }
  return new stop(where, new Message([`No inductive type found for ${name} at ${where}`]));
}
var initCtx = /* @__PURE__ */ new Map();
var Binder = class {
};
var Claim = class extends Binder {
  constructor(type) {
    super();
    this.type = type;
  }
};
var Define = class extends Binder {
  constructor(type, value) {
    super();
    this.type = type;
    this.value = value;
  }
};
var Free = class extends Binder {
  constructor(type) {
    super();
    this.type = type;
  }
};
var InductiveDatatypeBinder = class extends Binder {
  constructor(name, type) {
    super();
    this.name = name;
    this.type = type;
  }
};
var ConstructorTypeBinder = class extends Binder {
  constructor(name, constructorType, type) {
    super();
    this.name = name;
    this.constructorType = constructorType;
    this.type = type;
  }
};
function varType(ctx, where, x) {
  if (ctx.size === 0) {
    throw new Error(`The context ${JSON.stringify(ctx)} is empty, but we are looking for ${x}`);
  }
  for (const [y, binder] of ctx.entries()) {
    if (binder instanceof Claim) {
      continue;
    } else if (x === y) {
      if (binder instanceof InductiveDatatypeBinder) {
        return new go(new Universe());
      }
      return new go(binder.type);
    }
  }
  throw new Error(`Unknown variable ${x}`);
}
function bindFree(ctx, varName, tv) {
  if (ctx.has(varName)) {
    for (const [x] of ctx) {
      if (x === varName) {
        return extendContext(ctx, varName, new Free(tv));
      }
    }
    throw new Error(`
      ${varName} is already bound in ${JSON.stringify(ctx)}
    `);
  }
  return extendContext(ctx, varName, new Free(tv));
}
function bindVal(ctx, varName, type, value) {
  return extendContext(ctx, varName, new Define(type, value));
}

// src/pie_interpreter/utils/environment.ts
function extendEnvironment(env, name, value) {
  return new Map([...env, [name, value]]);
}
function getValueFromEnvironment(env, name) {
  if (env.has(name)) {
    return env.get(name);
  } else {
    throw new Error(`Variable ${name} not found in environment`);
  }
}

// src/pie_interpreter/evaluator/evaluator.ts
function doApp(operator, operand) {
  const operatorNow = operator.now();
  if (operatorNow instanceof Lambda) {
    return operatorNow.body.valOfClosure(operand);
  } else if (operatorNow instanceof Neutral) {
    const typeNow = operatorNow.type.now();
    if (typeNow instanceof Pi) {
      return new Neutral(
        typeNow.resultType.valOfClosure(operand),
        new Application(
          operatorNow.neutral,
          new Norm(typeNow.argType, operand)
        )
      );
    }
  }
  throw new Error(`doApp: invalid input ${[operatorNow, operand.now()]}`);
}
function doWhichNat(target, baseType, base, step) {
  const targetNow = target.now();
  if (targetNow instanceof Zero) {
    return base;
  } else if (targetNow instanceof Add1) {
    return doApp(step, targetNow.smaller);
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Nat) {
      return new Neutral(
        baseType,
        new WhichNat(
          targetNow.neutral,
          new Norm(baseType, base),
          new Norm(
            new Pi(
              "n",
              new Nat(),
              new HigherOrderClosure((_) => baseType)
            ),
            step
          )
        )
      );
    }
  }
  throw new Error(`invalid input for whichNat ${[target, baseType, base, step]}`);
}
function doIterNat(target, baseType, base, step) {
  const targetNow = target.now();
  if (targetNow instanceof Zero) {
    return base;
  } else if (targetNow instanceof Add1) {
    return doApp(
      step,
      doIterNat(targetNow.smaller, baseType, base, step)
    );
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Nat) {
      return new Neutral(
        baseType,
        new IterNat(
          targetNow.neutral,
          new Norm(baseType, base),
          new Norm(
            new Pi(
              "n",
              new Nat(),
              new HigherOrderClosure((_) => baseType)
            ),
            step
          )
        )
      );
    }
  }
  throw new Error(`invalid input for iterNat ${[target, baseType, base, step]}`);
}
function doRecNat(target, baseType, base, step) {
  const targetNow = target.now();
  if (targetNow instanceof Zero) {
    return base;
  } else if (targetNow instanceof Add1) {
    return doApp(
      doApp(step, targetNow.smaller),
      doRecNat(targetNow.smaller, baseType, base, step)
    );
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Nat) {
      return new Neutral(
        baseType,
        new RecNat(
          targetNow.neutral,
          new Norm(baseType, base),
          new Norm(
            new Pi(
              "n-1",
              new Nat(),
              new HigherOrderClosure(
                (_) => new Pi(
                  "ih",
                  baseType,
                  new HigherOrderClosure(
                    (_2) => baseType
                  )
                )
              )
            ),
            step
          )
        )
      );
    }
  }
  throw new Error(`invalid input for recNat ${[target, baseType, base, step]}`);
}
function doIndNat(target, motive, base, step) {
  const targetNow = target.now();
  if (targetNow instanceof Zero) {
    return base;
  } else if (targetNow instanceof Add1) {
    return doApp(
      doApp(step, targetNow.smaller),
      doIndNat(targetNow.smaller, motive, base, step)
    );
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Nat) {
      return new Neutral(
        doApp(motive, target),
        new IndNat(
          targetNow.neutral,
          new Norm(new Pi(
            "x",
            new Nat(),
            new HigherOrderClosure((_) => new Universe())
          ), motive),
          new Norm(doApp(motive, new Zero()), base),
          new Norm(
            new Pi(
              "n-1",
              new Nat(),
              new HigherOrderClosure(
                (n_minus_1) => new Pi(
                  "ih",
                  doApp(motive, n_minus_1),
                  new HigherOrderClosure(
                    (_) => doApp(motive, new Add1(n_minus_1))
                  )
                )
              )
            ),
            step
          )
        )
      );
    }
  }
  throw new Error(`invalid input for indNat ${[target, motive, base, step]}`);
}
function doCar(pair) {
  const pairNow = pair.now();
  if (pairNow instanceof Cons) {
    return pairNow.car;
  } else if (pairNow instanceof Neutral) {
    const pairType = pairNow.type.now();
    if (pairType instanceof Sigma) {
      const sigma = pairType;
      const neutral = pairNow.neutral;
      return new Neutral(sigma.carType, new Car(neutral));
    }
  }
  throw new Error(`invalid input for car ${pair}`);
}
function doCdr(pair) {
  const pairNow = pair.now();
  if (pairNow instanceof Cons) {
    return pairNow.cdr;
  } else if (pairNow instanceof Neutral) {
    const pairType = pairNow.type.now();
    if (pairType instanceof Sigma) {
      const sigma = pairType;
      const neutral = pairNow.neutral;
      return new Neutral(
        sigma.cdrType.valOfClosure(doCar(pair)),
        new Cdr(neutral)
      );
    }
  }
  throw new Error(`invalid input for cdr ${pair}`);
}
function doIndList(target, motive, base, step) {
  const targetNow = target.now();
  if (targetNow instanceof Nil) {
    return base;
  } else if (targetNow instanceof ListCons) {
    return doApp(
      doApp(
        doApp(
          step,
          targetNow.head
        ),
        targetNow.tail
      ),
      doIndList(targetNow.tail, motive, base, step)
    );
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof List) {
      const entryType = typeNow.entryType;
      const neutral = targetNow.neutral;
      const motiveType = new Pi(
        "xs",
        new List(entryType),
        new HigherOrderClosure((_) => new Universe())
      );
      return new Neutral(
        doApp(motive, target),
        new IndList(
          neutral,
          new Norm(motiveType, motive),
          new Norm(doApp(motive, new Nil()), base),
          new Norm(
            new Pi(
              "h",
              entryType,
              new HigherOrderClosure(
                (h) => new Pi(
                  "t",
                  new List(entryType),
                  new HigherOrderClosure(
                    (t) => new Pi(
                      "ih",
                      doApp(motive, t),
                      new HigherOrderClosure(
                        (_) => doApp(motive, new ListCons(h, t))
                      )
                    )
                  )
                )
              )
            ),
            step
          )
        )
      );
    }
  }
  throw new Error(`invalid input for indList ${[targetNow, motive, base, step]}`);
}
function doRecList(target, baseType, base, step) {
  const targetNow = target.now();
  if (targetNow instanceof Nil) {
    return base;
  } else if (targetNow instanceof ListCons) {
    const head = targetNow.head;
    const tail = targetNow.tail;
    return doApp(
      doApp(
        doApp(step, head),
        tail
      ),
      doRecList(tail, baseType, base, step)
    );
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof List) {
      const entryType = typeNow.entryType;
      const neutral = targetNow.neutral;
      return new Neutral(
        baseType,
        new RecList(
          neutral,
          new Norm(baseType, base),
          new Norm(
            new Pi(
              "h",
              entryType,
              new HigherOrderClosure(
                (_) => new Pi(
                  "t",
                  new List(entryType),
                  new HigherOrderClosure(
                    (_2) => new Pi(
                      "ih",
                      baseType,
                      new HigherOrderClosure(
                        (_3) => baseType
                      )
                    )
                  )
                )
              )
            ),
            step
          )
        )
      );
    }
  }
  throw new Error(`invalid input for recList ${[targetNow, baseType, base, step]}`);
}
function doIndAbsurd(target, motive) {
  const targetNow = target.now();
  if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Absurd) {
      return new Neutral(
        motive,
        new IndAbsurd(
          targetNow.neutral,
          new Norm(new Universe(), motive)
        )
      );
    }
  }
  throw new Error(`invalid input for indAbsurd ${[target, motive]}`);
}
function doReplace(target, motive, base) {
  const targetNow = target.now();
  if (targetNow instanceof Same) {
    return base;
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Equal) {
      const neutral = targetNow.neutral;
      const eqType = typeNow.type;
      const from = typeNow.from;
      const to = typeNow.to;
      return new Neutral(
        doApp(motive, to),
        new Replace(
          neutral,
          new Norm(
            new Pi(
              "x",
              eqType,
              new HigherOrderClosure(
                (_) => new Universe()
              )
            ),
            motive
          ),
          new Norm(doApp(motive, from), base)
        )
      );
    }
  }
  throw new Error(`invalid input for replace ${[target, motive, base]}`);
}
function doTrans(target1, target2) {
  const target1Now = target1.now();
  const target2Now = target2.now();
  if (target1Now instanceof Same && target2Now instanceof Same) {
    return new Same(target1Now.value);
  } else if (target1Now instanceof Same && target2Now instanceof Neutral) {
    const type2Now = target2Now.type.now();
    if (type2Now instanceof Equal) {
      const from = target1Now.value;
      const to = type2Now.to;
      const eqType = type2Now.type;
      const neutral2 = target2Now.neutral;
      return new Neutral(
        new Equal(eqType, from, to),
        new Trans2(
          new Norm(
            new Equal(eqType, from, from),
            new Same(from)
          ),
          neutral2
        )
      );
    }
  } else if (target1Now instanceof Neutral && target2Now instanceof Same) {
    const type1Now = target1Now.type.now();
    if (type1Now instanceof Equal) {
      const from = type1Now.from;
      const to = target2Now.value;
      const eqType = type1Now.type;
      const neutral1 = target1Now.neutral;
      return new Neutral(
        new Equal(eqType, from, to),
        new Trans1(
          neutral1,
          new Norm(
            new Equal(eqType, to, to),
            new Same(to)
          )
        )
      );
    }
  } else if (target1Now instanceof Neutral && target2Now instanceof Neutral) {
    const type1Now = target1Now.type.now();
    const type2Now = target2Now.type.now();
    if (type1Now instanceof Equal && type2Now instanceof Equal) {
      const from = type1Now.from;
      const to = type2Now.to;
      const eqType = type1Now.type;
      const neutral1 = target1Now.neutral;
      const neutral2 = target2Now.neutral;
      return new Neutral(
        new Equal(eqType, from, to),
        new Trans12(neutral1, neutral2)
      );
    }
  }
  throw new Error(`invalid input for do-trans: ${[target1, target2]}`);
}
function doCong(target, base, func) {
  const targetNow = target.now();
  if (targetNow instanceof Same) {
    return new Same(doApp(func, targetNow.value));
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Equal) {
      const eqType = typeNow.type;
      const from = typeNow.from;
      const to = typeNow.to;
      const neutral = targetNow.neutral;
      return new Neutral(
        new Equal(
          base,
          doApp(func, from),
          doApp(func, to)
        ),
        new Cong(
          neutral,
          new Norm(
            new Pi(
              "x",
              eqType,
              new HigherOrderClosure((_) => base)
            ),
            func
          )
        )
      );
    }
  }
  throw new Error(`invalid input for cong ${[target, base, func]}`);
}
function doSymm(target) {
  const targetNow = target.now();
  if (targetNow instanceof Same) {
    return new Same(targetNow.value);
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Equal) {
      return new Neutral(
        new Equal(
          typeNow.type,
          typeNow.to,
          typeNow.from
        ),
        new Symm(targetNow.neutral)
      );
    }
  }
  throw new Error(`invalid input for symm ${target}`);
}
function doIndEqual(target, motive, base) {
  const targetNow = target.now();
  if (targetNow instanceof Same) {
    return base;
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Equal) {
      const eqType = typeNow.type;
      const from = typeNow.from;
      const to = typeNow.to;
      const neutral = targetNow.neutral;
      return new Neutral(
        doApp(doApp(motive, to), target),
        new IndEqual(
          neutral,
          new Norm(
            new Pi(
              "to",
              eqType,
              new HigherOrderClosure(
                (to2) => new Pi(
                  "p",
                  new Equal(eqType, from, to2),
                  new HigherOrderClosure(
                    (_) => new Universe()
                  )
                )
              )
            ),
            motive
          ),
          new Norm(
            doApp(doApp(motive, from), new Same(from)),
            base
          )
        )
      );
    }
  }
  throw new Error(`invalid input for indEqual ${[target, motive, base]}`);
}
function doHead(target) {
  const targetNow = target.now();
  if (targetNow instanceof VecCons) {
    return targetNow.head;
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Vec) {
      const lengthNow = typeNow.length.now();
      if (lengthNow instanceof Add1) {
        return new Neutral(
          typeNow.entryType,
          new Head(targetNow.neutral)
        );
      }
    }
  }
  throw new Error(`invalid input for head ${target}`);
}
function doTail(target) {
  const targetNow = target.now();
  if (targetNow instanceof VecCons) {
    return targetNow.tail;
  } else if (targetNow instanceof Neutral && targetNow.type.now() instanceof Vec && targetNow.type.now().length.now() instanceof Add1) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Vec) {
      const lengthNow = typeNow.length.now();
      if (lengthNow instanceof Add1) {
        return new Neutral(
          new Vec(
            targetNow.type.now().entryType,
            targetNow.type.now().length.now().smaller
          ),
          new Tail(targetNow.neutral)
        );
      }
    }
  }
  throw new Error(`invalid input for tail ${target.prettyPrint()}`);
}
function indVecStepType(Ev, mot) {
  return new Pi(
    "k",
    new Nat(),
    new HigherOrderClosure(
      (k) => new Pi(
        "e",
        Ev,
        new HigherOrderClosure(
          (e) => new Pi(
            "es",
            new Vec(Ev, k),
            new HigherOrderClosure(
              (es) => new Pi(
                "ih",
                doApp(doApp(mot, k), es),
                new HigherOrderClosure(
                  (_) => doApp(
                    doApp(mot, new Add1(k)),
                    new VecCons(e, es)
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}
function doIndVec(len, vec, motive, base, step) {
  const lenNow = len.now();
  const vecNow = vec.now();
  if (lenNow instanceof Zero && vecNow instanceof VecNil) {
    return base;
  } else if (lenNow instanceof Add1 && vecNow instanceof VecCons) {
    return doApp(
      doApp(
        doApp(
          doApp(step, lenNow.smaller),
          vecNow.head
        ),
        doTail(vec)
      ),
      doIndVec(
        lenNow.smaller,
        vecNow.tail,
        motive,
        base,
        step
      )
    );
  } else if (lenNow instanceof Neutral && vecNow instanceof Neutral && lenNow.type.now() instanceof Nat && vecNow.type.now() instanceof Vec) {
    const entryType = vecNow.type.now().entryType;
    return new Neutral(
      doApp(doApp(motive, len), vec),
      new IndVec12(
        lenNow.neutral,
        vecNow.neutral,
        new Norm(
          new Pi(
            "k",
            new Nat(),
            new HigherOrderClosure(
              (k) => new Pi(
                "es",
                new Vec(entryType, k),
                new HigherOrderClosure(
                  (_) => new Universe()
                )
              )
            )
          ),
          motive
        ),
        new Norm(
          doApp(
            doApp(motive, new Zero()),
            new VecNil()
          ),
          base
        ),
        new Norm(
          indVecStepType(
            vecNow.type.now().entryType,
            motive
          ),
          step
        )
      )
    );
  } else if (natEqual(lenNow, len) && vecNow instanceof Neutral && vecNow.type.now() instanceof Vec) {
    const entryType = vecNow.type.now().entryType;
    return new Neutral(
      doApp(doApp(motive, len), vec),
      new IndVec2(
        new Norm(new Nat(), len),
        vecNow.neutral,
        new Norm(
          new Pi(
            "k",
            new Nat(),
            new HigherOrderClosure(
              (k) => new Pi(
                "es",
                new Vec(entryType, k),
                new HigherOrderClosure(
                  (_) => new Universe()
                )
              )
            )
          ),
          motive
        ),
        new Norm(
          doApp(
            doApp(motive, new Nat()),
            new VecNil()
          ),
          base
        ),
        new Norm(
          indVecStepType(
            entryType,
            motive
          ),
          step
        )
      )
    );
  } else {
    throw new Error(`invalid input for indVec ${[len, vec, motive, base, step]}`);
  }
}
function doIndEither(target, motive, left, right) {
  const targetNow = target.now();
  if (targetNow instanceof Left) {
    return doApp(left, targetNow.value);
  } else if (targetNow instanceof Right) {
    return doApp(right, targetNow.value);
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof Either) {
      const leftType = typeNow.leftType;
      const rightType = typeNow.rightType;
      const motiveType = new Pi(
        "x",
        new Either(leftType, rightType),
        new HigherOrderClosure((_) => new Universe())
      );
      return new Neutral(
        doApp(motive, target),
        new IndEither(
          targetNow.neutral,
          new Norm(motiveType, motive),
          new Norm(
            new Pi(
              "x",
              leftType,
              new HigherOrderClosure(
                (x) => doApp(motive, new Left(x))
              )
            ),
            left
          ),
          new Norm(
            new Pi(
              "x",
              rightType,
              new HigherOrderClosure(
                (x) => doApp(motive, new Right(x))
              )
            ),
            right
          )
        )
      );
    }
  }
  throw new Error(`invalid input for indEither: ${[target, motive, left, right]}`);
}
function doEliminator(name, target, motive, methods, methodTypes, motiveType) {
  const targetNow = target.now();
  if (targetNow instanceof Constructor) {
    if (targetNow.type != name) {
      throw new Error(`doEliminator: wrong eliminator used. Got constructor of type: ${targetNow.type}; Expected: ${name}`);
    }
    const constructorIndex = targetNow.index;
    if (constructorIndex >= 0 && constructorIndex < methods.length) {
      const method = methods[constructorIndex];
      let result = method;
      for (let i = 0; i < targetNow.args.length; i++) {
        const arg = targetNow.args[i].now();
        result = doApp(result, arg);
      }
      for (let i = 0; i < targetNow.recursive_args.length; i++) {
        const arg = targetNow.recursive_args[i].now();
        result = doApp(result, arg);
        const recursiveResult = doEliminator(name, arg, motive, methods, methodTypes, motiveType);
        result = doApp(result, recursiveResult);
      }
      return result;
    }
  } else if (targetNow instanceof Neutral) {
    const typeNow = targetNow.type.now();
    if (typeNow instanceof InductiveTypeConstructor2 && typeNow.name === name) {
      let resultType = motive;
      for (const indexValue of typeNow.indices) {
        resultType = doApp(resultType, indexValue);
      }
      resultType = doApp(resultType, target);
      return new Neutral(
        resultType,
        new GenericEliminator(
          name,
          targetNow.neutral,
          new Norm(
            motiveType ? motiveType : new Pi(
              "x",
              typeNow,
              new HigherOrderClosure((_) => new Universe())
            ),
            motive
          ),
          methods.map(
            (method, i) => new Norm(
              methodTypes && methodTypes[i] ? methodTypes[i] : typeNow,
              // Use provided method type or fallback
              method
            )
          )
        )
      );
    }
  }
  throw new Error(`doEliminator: invalid input for ${name}: ${[target, motive, methods]}`);
}

// src/pie_interpreter/evaluator/utils.ts
function natEqual(nat1, nat2) {
  const nat1Now = nat1.now();
  const nat2Now = nat2.now();
  if (nat1Now instanceof Zero && nat2Now instanceof Zero) {
    return true;
  } else if (nat1Now instanceof Add1 && nat2Now instanceof Add1) {
    return natEqual(nat1Now.smaller, nat2Now.smaller);
  } else {
    return false;
  }
}
function readBack(context, type, value) {
  const typeNow = type.now();
  const valueNow = value.now();
  if (typeNow instanceof Universe) {
    return value.readBackType(context);
  } else if (typeNow instanceof Nat && valueNow instanceof Zero) {
    return new Zero2();
  } else if (typeNow instanceof Nat && valueNow instanceof Add1) {
    return new Add12(
      readBack(context, new Nat(), valueNow.smaller)
    );
  } else if (typeNow instanceof Pi) {
    const y = valueNow instanceof Lambda ? valueNow.argName : typeNow.argName;
    const freshx = fresh(context, y);
    return new Lambda2(freshx, readBack(
      bindFree(context, freshx, typeNow.argType),
      typeNow.resultType.valOfClosure(
        new Neutral(typeNow.argType, new Variable(freshx))
      ),
      doApp(
        valueNow,
        new Neutral(typeNow.argType, new Variable(freshx))
      )
    ));
  } else if (typeNow instanceof Sigma) {
    const car = doCar(value);
    const cdr = doCdr(value);
    return new Cons2(
      readBack(context, typeNow.carType, car),
      readBack(
        context,
        typeNow.cdrType.valOfClosure(car),
        cdr
      )
    );
  } else if (typeNow instanceof Atom && valueNow instanceof Quote) {
    return new Quote2(valueNow.name);
  } else if (typeNow instanceof Trivial) {
    return new Sole();
  } else if (typeNow instanceof List && valueNow instanceof Nil) {
    return new Nil2();
  } else if (typeNow instanceof List && valueNow instanceof ListCons) {
    return new Cons2(
      readBack(context, typeNow.entryType, valueNow.head),
      readBack(context, new List(typeNow.entryType), valueNow.tail)
    );
  } else if (typeNow instanceof Absurd && valueNow instanceof Neutral) {
    return new The(
      new Absurd2(),
      valueNow.neutral.readBackNeutral(context)
    );
  } else if (typeNow instanceof Equal && valueNow instanceof Same) {
    return new Same2(
      readBack(context, typeNow.type, valueNow.value)
    );
  } else if (typeNow instanceof Vec && typeNow.length.now() instanceof Zero && valueNow instanceof VecNil) {
    return new VecNil2();
  } else if (typeNow instanceof Vec && typeNow.length.now() instanceof Add1 && valueNow instanceof VecCons) {
    const lenNow = typeNow.length.now();
    return new VecCons2(
      readBack(context, typeNow.entryType, valueNow.head),
      readBack(
        context,
        new Vec(typeNow.entryType, typeNow.length.now().smaller),
        valueNow.tail
      )
    );
  } else if (typeNow instanceof Either && valueNow instanceof Left) {
    return new Left2(
      readBack(context, typeNow.leftType, valueNow.value)
    );
  } else if (typeNow instanceof Either && valueNow instanceof Right) {
    return new Right2(
      readBack(context, typeNow.rightType, valueNow.value)
    );
  } else if (typeNow instanceof InductiveTypeConstructor2 && valueNow instanceof Constructor) {
    let ctorBinder;
    for (const [name, binder] of context) {
      if (name === valueNow.name && binder instanceof ConstructorTypeBinder) {
        ctorBinder = binder;
        break;
      }
    }
    if (!ctorBinder) {
      throw new Error(`Constructor ${valueNow.name} not found in context`);
    }
    const ctorTypeCore = ctorBinder.constructorType;
    const resultTypeCore = ctorTypeCore.resultType;
    let substEnv = contextToEnvironment(context);
    for (let i = 0; i < resultTypeCore.parameters.length; i++) {
      const paramCore = resultTypeCore.parameters[i];
      if (paramCore instanceof VarName) {
        const paramName = paramCore.name;
        const concreteValue = typeNow.parameters[i].now();
        substEnv = extendEnvironment(substEnv, paramName, concreteValue);
      }
    }
    for (let i = 0; i < resultTypeCore.indices.length; i++) {
      const indexCore = resultTypeCore.indices[i];
      if (indexCore instanceof VarName) {
        const indexName = indexCore.name;
        const concreteValue = typeNow.indices[i].now();
        substEnv = extendEnvironment(substEnv, indexName, concreteValue);
      }
    }
    const returnTypeValue = ctorBinder.type;
    const indexArgNames = [];
    returnTypeValue.indices.forEach((i) => {
      indexArgNames.push(...extractVarNamesFromValue(i));
    });
    const readBackArgs = [];
    for (let i = 0; i < valueNow.args.length; i++) {
      const argTypeCore = ctorTypeCore.argTypes[i];
      const argTypeValue = argTypeCore.valOf(substEnv);
      const readBackArg = readBack(context, argTypeValue.now(), valueNow.args[i]);
      readBackArgs.push(readBackArg);
      if (i < indexArgNames.length) {
        const argName = indexArgNames[i];
        const argValue = valueNow.args[i].now();
        substEnv = extendEnvironment(substEnv, argName, argValue);
      }
    }
    const readBackRecArgs = [];
    const recArgStartIdx = valueNow.args.length;
    for (let i = 0; i < valueNow.recursive_args.length; i++) {
      const recArgTypeCore = ctorTypeCore.rec_argTypes[i];
      const recArgTypeValue = recArgTypeCore.valOf(substEnv);
      const readBackRecArg = readBack(context, recArgTypeValue.now(), valueNow.recursive_args[i]);
      readBackRecArgs.push(readBackRecArg);
      const argNameIdx = recArgStartIdx + i;
      if (argNameIdx < indexArgNames.length) {
        const argName = indexArgNames[argNameIdx];
        const recArgValue = valueNow.recursive_args[i].now();
        substEnv = extendEnvironment(substEnv, argName, recArgValue);
      }
    }
    return new Constructor2(
      valueNow.name,
      valueNow.index,
      valueNow.type,
      readBackArgs,
      readBackRecArgs
    );
  } else if (valueNow instanceof Neutral) {
    return valueNow.neutral.readBackNeutral(context);
  }
  throw new Error(`Cannot read back ${valueNow.prettyPrint()} : ${typeNow.prettyPrint()}`);
}

// src/pie_interpreter/types/neutral.ts
var Norm = class {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }
};
var Neutral2 = class {
  constructor() {
  }
  toString() {
    return this.prettyPrint();
  }
};
var Variable = class extends Neutral2 {
  constructor(name) {
    super();
    this.name = name;
  }
  readBackNeutral(_) {
    return new VarName(this.name);
  }
  prettyPrint() {
    return `N-${this.name}`;
  }
};
var TODO2 = class extends Neutral2 {
  constructor(where, type) {
    super();
    this.where = where;
    this.type = type;
  }
  readBackNeutral(context) {
    return new TODO(
      this.where,
      this.type.readBackType(context)
    );
  }
  prettyPrint() {
    return `N-TODO`;
  }
};
var WhichNat = class extends Neutral2 {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new WhichNat2(
      this.target.readBackNeutral(context),
      new The(
        this.base.type.readBackType(context),
        readBack(context, this.base.type, this.base.value)
      ),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-WhichNat`;
  }
};
var IterNat = class extends Neutral2 {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new IterNat2(
      this.target.readBackNeutral(context),
      new The(
        this.base.type.readBackType(context),
        readBack(context, this.base.type, this.base.value)
      ),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-IterNat`;
  }
};
var RecNat = class extends Neutral2 {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new RecNat2(
      this.target.readBackNeutral(context),
      new The(
        this.base.type.readBackType(context),
        readBack(context, this.base.type, this.base.value)
      ),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-RecNat`;
  }
};
var IndNat = class extends Neutral2 {
  constructor(target, motive, base, step) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new IndNat2(
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.base.type, this.base.value),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-IndNat`;
  }
};
var Car = class extends Neutral2 {
  constructor(target) {
    super();
    this.target = target;
  }
  readBackNeutral(context) {
    return new Car2(this.target.readBackNeutral(context));
  }
  prettyPrint() {
    return `N-Car`;
  }
};
var Cdr = class extends Neutral2 {
  constructor(target) {
    super();
    this.target = target;
  }
  readBackNeutral(context) {
    return new Cdr2(this.target.readBackNeutral(context));
  }
  prettyPrint() {
    return `N-Cdr`;
  }
};
var RecList = class extends Neutral2 {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new RecList2(
      this.target.readBackNeutral(context),
      new The(
        this.base.type.readBackType(context),
        readBack(context, this.base.type, this.base.value)
      ),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-RecList`;
  }
};
var IndList = class extends Neutral2 {
  constructor(target, motive, base, step) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new IndList2(
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.base.type, this.base.value),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-IndList`;
  }
};
var IndAbsurd = class extends Neutral2 {
  constructor(target, motive) {
    super();
    this.target = target;
    this.motive = motive;
  }
  readBackNeutral(context) {
    return new IndAbsurd2(
      new The(
        new Absurd2(),
        this.target.readBackNeutral(context)
      ),
      readBack(context, this.motive.type, this.motive.value)
    );
  }
  prettyPrint() {
    return `N-IndAbsurd`;
  }
};
var Replace = class extends Neutral2 {
  constructor(target, motive, base) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
  }
  readBackNeutral(context) {
    return new Replace2(
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.base.type, this.base.value)
    );
  }
  prettyPrint() {
    return `N-Replace`;
  }
};
var Trans1 = class extends Neutral2 {
  constructor(target1, target2) {
    super();
    this.target1 = target1;
    this.target2 = target2;
  }
  readBackNeutral(context) {
    return new Trans(
      this.target1.readBackNeutral(context),
      readBack(context, this.target2.type, this.target2.value)
    );
  }
  prettyPrint() {
    return `N-Trans1`;
  }
};
var Trans2 = class extends Neutral2 {
  constructor(target1, target2) {
    super();
    this.target1 = target1;
    this.target2 = target2;
  }
  readBackNeutral(context) {
    return new Trans(
      readBack(context, this.target1.type, this.target1.value),
      this.target2.readBackNeutral(context)
    );
  }
  prettyPrint() {
    return `N-Trans2`;
  }
};
var Trans12 = class extends Neutral2 {
  constructor(target1, target2) {
    super();
    this.target1 = target1;
    this.target2 = target2;
  }
  readBackNeutral(context) {
    return new Trans(
      this.target1.readBackNeutral(context),
      this.target2.readBackNeutral(context)
    );
  }
  prettyPrint() {
    return `N-Trans12`;
  }
};
var Cong = class extends Neutral2 {
  constructor(target, func) {
    super();
    this.target = target;
    this.func = func;
  }
  readBackNeutral(context) {
    const funcType = this.func.type;
    if (funcType instanceof Pi) {
      const closure = funcType.resultType;
      return new Cong2(
        this.target.readBackNeutral(context),
        closure.valOfClosure(new Absurd()).readBackType(context),
        readBack(context, this.func.type, this.func.value)
      );
    } else {
      throw new Error("Cong applied to non-Pi type.");
    }
  }
  prettyPrint() {
    return `N-Cong`;
  }
};
var Symm = class extends Neutral2 {
  constructor(target) {
    super();
    this.target = target;
  }
  readBackNeutral(context) {
    return new Symm2(this.target.readBackNeutral(context));
  }
  prettyPrint() {
    return `N-Symm`;
  }
};
var IndEqual = class extends Neutral2 {
  constructor(target, motive, base) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
  }
  readBackNeutral(context) {
    return new IndEqual2(
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.base.type, this.base.value)
    );
  }
  prettyPrint() {
    return `N-IndEqual`;
  }
};
var Head = class extends Neutral2 {
  constructor(target) {
    super();
    this.target = target;
  }
  readBackNeutral(context) {
    return new Head2(this.target.readBackNeutral(context));
  }
  prettyPrint() {
    return `N-Head`;
  }
};
var Tail = class extends Neutral2 {
  constructor(target) {
    super();
    this.target = target;
  }
  readBackNeutral(context) {
    return new Tail2(this.target.readBackNeutral(context));
  }
  prettyPrint() {
    return `N-Tail`;
  }
};
var IndVec2 = class extends Neutral2 {
  constructor(length, target, motive, base, step) {
    super();
    this.length = length;
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new IndVec(
      readBack(context, this.length.type, this.length.value),
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.base.type, this.base.value),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-IndVec2`;
  }
};
var IndVec12 = class extends Neutral2 {
  constructor(length, target, motive, base, step) {
    super();
    this.length = length;
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  readBackNeutral(context) {
    return new IndVec(
      this.length.readBackNeutral(context),
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.base.type, this.base.value),
      readBack(context, this.step.type, this.step.value)
    );
  }
  prettyPrint() {
    return `N-IndVec12`;
  }
};
var IndEither = class extends Neutral2 {
  constructor(target, motive, baseLeft, baseRight) {
    super();
    this.target = target;
    this.motive = motive;
    this.baseLeft = baseLeft;
    this.baseRight = baseRight;
  }
  readBackNeutral(context) {
    return new IndEither2(
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      readBack(context, this.baseLeft.type, this.baseLeft.value),
      readBack(context, this.baseRight.type, this.baseRight.value)
    );
  }
  prettyPrint() {
    return `N-IndEither`;
  }
};
var GenericEliminator = class extends Neutral2 {
  constructor(typeName, target, motive, methods) {
    super();
    this.typeName = typeName;
    this.target = target;
    this.motive = motive;
    this.methods = methods;
  }
  readBackNeutral(context) {
    return new Eliminator(
      this.typeName,
      this.target.readBackNeutral(context),
      readBack(context, this.motive.type, this.motive.value),
      this.methods.map((method) => readBack(context, method.type, method.value))
    );
  }
  prettyPrint() {
    return `N-GenericEliminator-${this.typeName}`;
  }
};
var Application = class extends Neutral2 {
  constructor(operator, operand) {
    super();
    this.operator = operator;
    this.operand = operand;
  }
  readBackNeutral(context) {
    return new Application2(
      this.operator.readBackNeutral(context),
      readBack(context, this.operand.type, this.operand.value)
    );
  }
  prettyPrint() {
    return `N-Application`;
  }
};

// src/pie_interpreter/types/value.ts
var Value3 = class {
  /*
  now demands the _actual_ value represented by a DELAY. If the value
  is a DELAY-CLOS, then it is computed using undelay. If it is
  anything else, then it has already been computed, so it is
  returned.
  
  now should be used any time that a value is inspected to see what
  form it has, because those situations require that the delayed
  evaluation steps be carried out.
  */
  now() {
    return this;
  }
};
var DelayClosure = class {
  constructor(env, expr) {
    this.env = env;
    this.expr = expr;
  }
  /*
    undelay is used to find the value that is contained in a
    DELAY-CLOS closure by invoking the evaluator.
  */
  undelay() {
    return this.expr.valOf(this.env).now();
  }
  toString() {
    return `DelayClosure(${this.env}, ${this.expr})`;
  }
};
var Box = class {
  constructor(value) {
    this.content = value;
  }
  get() {
    return this.content;
  }
  set(value) {
    this.content = value;
  }
};
var Delay = class extends Value3 {
  constructor(val) {
    super();
    this.val = val;
  }
  now() {
    const boxContent = this.val.get();
    if (boxContent instanceof DelayClosure) {
      const theValue = boxContent.undelay();
      this.val.set(theValue);
      return theValue;
    } else {
      return boxContent;
    }
  }
  readBackType(context) {
    return this.now().readBackType(context);
  }
  prettyPrint() {
    return this.now().prettyPrint();
  }
  toString() {
    return `Delay(${this.val})`;
  }
};
var Quote = class extends Value3 {
  constructor(name) {
    super();
    this.name = name;
  }
  readBackType(_) {
    throw new Error("No readBackType for Quote.");
  }
  prettyPrint() {
    return `'${this.name}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Nat = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    return new Nat2();
  }
  prettyPrint() {
    return "Nat";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Zero = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    throw new Error("No readBackType for Zero.");
  }
  prettyPrint() {
    return "zero";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Add1 = class extends Value3 {
  constructor(smaller) {
    super();
    this.smaller = smaller;
  }
  readBackType(_) {
    throw new Error("No readBackType for Add1.");
  }
  prettyPrint() {
    return `(add1 ${this.smaller.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Pi = class extends Value3 {
  constructor(argName, argType, resultType) {
    super();
    this.argName = argName;
    this.argType = argType;
    this.resultType = resultType;
  }
  readBackType(context) {
    const Aexpr = this.argType.readBackType(context);
    const freshedName = fresh(context, this.argName);
    const excludeNameCtx = bindFree(context, freshedName, this.argType);
    return new Pi2(
      freshedName,
      Aexpr,
      this.resultType.valOfClosure(
        new Neutral(this.argType, new Variable(freshedName))
      ).readBackType(excludeNameCtx)
    );
  }
  prettyPrint() {
    return `(\u03A0 ${this.argName} ${this.argType.prettyPrint()} ${this.resultType.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Lambda = class extends Value3 {
  constructor(argName, body) {
    super();
    this.argName = argName;
    this.body = body;
  }
  readBackType(_) {
    throw new Error("No readBackType for Lambda.");
  }
  prettyPrint() {
    return `(lambda ${this.argName} ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Sigma = class extends Value3 {
  constructor(carName, carType, cdrType) {
    super();
    this.carName = carName;
    this.carType = carType;
    this.cdrType = cdrType;
  }
  readBackType(context) {
    const Aexpr = this.carType.readBackType(context);
    const freshedName = fresh(context, this.carName);
    const excludeNameCtx = bindFree(context, freshedName, this.carType);
    return new Sigma2(
      freshedName,
      Aexpr,
      this.cdrType.valOfClosure(
        new Neutral(this.carType, new Variable(freshedName))
      ).readBackType(excludeNameCtx)
    );
  }
  prettyPrint() {
    return `(\u03A3 ${this.carName} ${this.carType.prettyPrint()} ${this.cdrType.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cons = class extends Value3 {
  constructor(car, cdr) {
    super();
    this.car = car;
    this.cdr = cdr;
  }
  readBackType(_) {
    throw new Error("No readBackType for Cons.");
  }
  prettyPrint() {
    return `(cons ${this.car.prettyPrint()} ${this.cdr.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var List = class extends Value3 {
  constructor(entryType) {
    super();
    this.entryType = entryType;
  }
  readBackType(context) {
    return new List2(this.entryType.readBackType(context));
  }
  prettyPrint() {
    return `(List ${this.entryType.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Nil = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    throw new Error("No readBackType for Nil.");
  }
  prettyPrint() {
    return "nil";
  }
  toString() {
    return this.prettyPrint();
  }
};
var ListCons = class extends Value3 {
  constructor(head, tail) {
    super();
    this.head = head;
    this.tail = tail;
  }
  readBackType(_) {
    throw new Error("No readBackType for ListCons.");
  }
  prettyPrint() {
    return `(:: ${this.head.prettyPrint()} ${this.tail.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Equal = class extends Value3 {
  constructor(type, from, to) {
    super();
    this.type = type;
    this.from = from;
    this.to = to;
  }
  readBackType(context) {
    return new Equal2(
      this.type.readBackType(context),
      readBack(context, this.type, this.from),
      readBack(context, this.type, this.to)
    );
  }
  prettyPrint() {
    return `(= ${this.type.prettyPrint()} ${this.from.prettyPrint()} ${this.to.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Same = class extends Value3 {
  constructor(value) {
    super();
    this.value = value;
  }
  readBackType(_) {
    throw new Error("No readBackType for Same.");
  }
  prettyPrint() {
    return `(same ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Vec = class extends Value3 {
  constructor(entryType, length) {
    super();
    this.entryType = entryType;
    this.length = length;
  }
  readBackType(context) {
    return new Vec2(
      this.entryType.readBackType(context),
      readBack(context, new Nat(), this.length)
    );
  }
  prettyPrint() {
    return `(Vec ${this.entryType.prettyPrint()} ${this.length.prettyPrint()})`;
  }
};
var VecNil = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    throw new Error("No readBackType for VecNil.");
  }
  prettyPrint() {
    return "vecnil";
  }
  toString() {
    return this.prettyPrint();
  }
};
var VecCons = class extends Value3 {
  constructor(head, tail) {
    super();
    this.head = head;
    this.tail = tail;
  }
  readBackType(_) {
    throw new Error("No readBackType for VecCons.");
  }
  prettyPrint() {
    return `(vec:: ${this.head.prettyPrint()} ${this.tail.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Either = class extends Value3 {
  constructor(leftType, rightType) {
    super();
    this.leftType = leftType;
    this.rightType = rightType;
  }
  readBackType(context) {
    return new Either2(
      this.leftType.readBackType(context),
      this.rightType.readBackType(context)
    );
  }
  prettyPrint() {
    return `(Either ${this.leftType.prettyPrint()} ${this.rightType.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Left = class extends Value3 {
  constructor(value) {
    super();
    this.value = value;
  }
  readBackType(_) {
    throw new Error("No readBackType for Left.");
  }
  prettyPrint() {
    return `(left ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Right = class extends Value3 {
  constructor(value) {
    super();
    this.value = value;
  }
  readBackType(_) {
    throw new Error("No readBackType for Right.");
  }
  prettyPrint() {
    return `(right ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Neutral = class extends Value3 {
  constructor(type, neutral) {
    super();
    this.type = type;
    this.neutral = neutral;
  }
  readBackType(context) {
    return this.neutral.readBackNeutral(context);
  }
  prettyPrint() {
    return `(Neutral ${this.type.prettyPrint()} ${this.neutral.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Universe = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    return new Universe2();
  }
  prettyPrint() {
    return "U";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Atom = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    return new Atom2();
  }
  prettyPrint() {
    return "Atom";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Trivial = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    return new Trivial2();
  }
  prettyPrint() {
    return "Trivial";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Sole2 = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    throw new Error("No readBackType for Sole.");
  }
  prettyPrint() {
    return "sole";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Absurd = class extends Value3 {
  constructor() {
    super();
  }
  readBackType(_) {
    return new Absurd2();
  }
  prettyPrint() {
    return "Absurd";
  }
  toString() {
    return this.prettyPrint();
  }
};
var InductiveTypeConstructor2 = class extends Value3 {
  constructor(name, parameters, indices) {
    super();
    this.name = name;
    this.parameters = parameters;
    this.indices = indices;
  }
  readBackType(context) {
    const inductiveBinder = context.get(this.name);
    let indexTypes = [];
    if (inductiveBinder && inductiveBinder instanceof InductiveDatatypeBinder) {
      const inductiveType = inductiveBinder.type;
      if (inductiveType instanceof InductiveType3) {
        indexTypes = inductiveType.indexTypes;
      }
    }
    return new InductiveTypeConstructor3(
      this.name,
      this.parameters.map((p) => p.readBackType(context)),
      this.indices.map((i, idx) => {
        const indexType = indexTypes[idx]?.now();
        if (i instanceof Delay) {
          const boxContent = i.val.get();
          if (boxContent instanceof DelayClosure) {
            try {
              const iNow = i.now();
              if (indexType) {
                return readBack(context, indexType, iNow);
              } else if (iNow instanceof Neutral) {
                return iNow.neutral.readBackNeutral(context);
              } else {
                return boxContent.expr;
              }
            } catch (e) {
              return boxContent.expr;
            }
          } else {
            const val = boxContent;
            if (indexType) {
              return readBack(context, indexType, val);
            } else if (val instanceof Neutral) {
              return val.neutral.readBackNeutral(context);
            } else {
              throw new Error(`Cannot read back index without type: ${val.prettyPrint()}`);
            }
          }
        } else {
          const iNow = i.now();
          if (indexType) {
            return readBack(context, indexType, iNow);
          } else if (iNow instanceof Neutral) {
            return iNow.neutral.readBackNeutral(context);
          } else {
            throw new Error(`Cannot read back index without type: ${iNow.prettyPrint()}`);
          }
        }
      })
    );
  }
  prettyPrint() {
    return `InductiveType ${this.name}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var InductiveType3 = class extends Value3 {
  constructor(name, parameterTypes, indexTypes) {
    super();
    this.name = name;
    this.parameterTypes = parameterTypes;
    this.indexTypes = indexTypes;
  }
  readBackType(context) {
    return new InductiveType2(
      this.name,
      this.parameterTypes.map((p) => p.readBackType(context)),
      this.indexTypes.map((i) => i.readBackType(context))
    );
  }
  prettyPrint() {
    return `InductiveType ${this.name}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Constructor = class extends Value3 {
  constructor(name, type, args, index, recursive_args) {
    super();
    this.name = name;
    this.type = type;
    this.args = args;
    this.index = index;
    this.recursive_args = recursive_args;
  }
  readBackType(context) {
    throw new Error("No readBackType for Constructor.");
  }
  prettyPrint() {
    const args = this.args.map((a) => a.prettyPrint()).join(" ");
    return `(${this.name}${args.length > 0 ? " " + args : ""})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var ConstructorType = class extends Value3 {
  constructor(name, index, type, argTypes, rec_argTypes, resultType, argNames, rec_argNames) {
    super();
    this.name = name;
    this.index = index;
    this.type = type;
    this.argTypes = argTypes;
    this.rec_argTypes = rec_argTypes;
    this.resultType = resultType;
    this.argNames = argNames;
    this.rec_argNames = rec_argNames;
  }
  readBackType(context) {
    throw Error("Method not implemented");
  }
  prettyPrint() {
    return `ConstructorType (${this.argTypes.map((a) => a.prettyPrint()).join(" ")})`;
  }
};

// src/pie_interpreter/types/core.ts
var Core = class {
  /*
    Original "later" function. It is used to delay the evaluation.
  */
  toLazy(env) {
    return new Delay(new Box(new DelayClosure(env, this)));
  }
};
var The = class extends Core {
  constructor(type, expr) {
    super();
    this.type = type;
    this.expr = expr;
  }
  valOf(env) {
    return this.expr.valOf(env);
  }
  prettyPrint() {
    return `(the ${this.type.prettyPrint()} ${this.expr.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Universe2 = class extends Core {
  valOf(_) {
    return new Universe();
  }
  prettyPrint() {
    return "U";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Nat2 = class extends Core {
  valOf(_) {
    return new Nat();
  }
  prettyPrint() {
    return "Nat";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Zero2 = class extends Core {
  valOf(_) {
    return new Zero();
  }
  prettyPrint() {
    return "0";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Add12 = class extends Core {
  constructor(n) {
    super();
    this.n = n;
  }
  valOf(env) {
    return new Add1(this.n.toLazy(env));
  }
  prettyPrint() {
    const n = Number(this.n.prettyPrint());
    if (!isNaN(n)) {
      return `${n + 1}`;
    }
    return `(add1 ${this.n.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var WhichNat2 = class extends Core {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doWhichNat(
      this.target.toLazy(env),
      this.base.type.toLazy(env),
      this.base.expr.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `(which-Nat ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IterNat2 = class extends Core {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doIterNat(
      this.target.toLazy(env),
      this.base.type.toLazy(env),
      this.base.expr.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `(iter-Nat ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var RecNat2 = class extends Core {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doRecNat(
      this.target.toLazy(env),
      this.base.type.toLazy(env),
      this.base.expr.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `(rec-Nat ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndNat2 = class extends Core {
  constructor(target, motive, base, step) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doIndNat(
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.base.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `(ind-Nat ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Pi2 = class extends Core {
  constructor(name, type, body) {
    super();
    this.name = name;
    this.type = type;
    this.body = body;
  }
  valOf(env) {
    const typeVal = this.type.toLazy(env);
    return new Pi(
      this.name,
      typeVal,
      new FirstOrderClosure(env, this.name, this.body)
    );
  }
  prettyPrint() {
    return `(\u03A0 (${this.name} ${this.type.prettyPrint()}) 
          ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Lambda2 = class extends Core {
  constructor(param, body) {
    super();
    this.param = param;
    this.body = body;
  }
  valOf(env) {
    return new Lambda(
      this.param,
      new FirstOrderClosure(env, this.param, this.body)
    );
  }
  prettyPrint() {
    return `(\u03BB (${this.param}) ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Atom2 = class extends Core {
  valOf(_) {
    return new Atom();
  }
  prettyPrint() {
    return "Atom";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Quote2 = class extends Core {
  constructor(sym) {
    super();
    this.sym = sym;
  }
  valOf(_) {
    return new Quote(this.sym);
  }
  prettyPrint() {
    return `'${this.sym}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Sigma2 = class extends Core {
  constructor(name, type, body) {
    super();
    this.name = name;
    this.type = type;
    this.body = body;
  }
  valOf(env) {
    const typeVal = this.type.toLazy(env);
    return new Sigma(
      this.name,
      typeVal,
      new FirstOrderClosure(env, this.name, this.body)
    );
  }
  prettyPrint() {
    return `(\u03A3 (${this.name} ${this.type.prettyPrint()}) 
              ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cons2 = class extends Core {
  constructor(first, second) {
    super();
    this.first = first;
    this.second = second;
  }
  valOf(env) {
    const first = this.first.toLazy(env);
    const second = this.second.toLazy(env);
    return new Cons(first, second);
  }
  prettyPrint() {
    return `(cons ${this.first.prettyPrint()} ${this.second.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Car2 = class extends Core {
  constructor(pair) {
    super();
    this.pair = pair;
  }
  valOf(env) {
    return doCar(this.pair.toLazy(env));
  }
  prettyPrint() {
    return `(car ${this.pair.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cdr2 = class extends Core {
  constructor(pair) {
    super();
    this.pair = pair;
  }
  valOf(env) {
    return doCdr(this.pair.toLazy(env));
  }
  prettyPrint() {
    return `(cdr ${this.pair.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var ListCons2 = class extends Core {
  constructor(head, tail) {
    super();
    this.head = head;
    this.tail = tail;
  }
  valOf(env) {
    const head = this.head.toLazy(env);
    const tail = this.tail.toLazy(env);
    return new ListCons(head, tail);
  }
  prettyPrint() {
    return `(:: ${this.head.prettyPrint()} ${this.tail.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Nil2 = class extends Core {
  valOf(_) {
    return new Nil();
  }
  prettyPrint() {
    return "nil";
  }
  toString() {
    return this.prettyPrint();
  }
};
var List2 = class extends Core {
  constructor(elemType) {
    super();
    this.elemType = elemType;
  }
  valOf(env) {
    return new List(this.elemType.toLazy(env));
  }
  prettyPrint() {
    return `(List ${this.elemType.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var RecList2 = class extends Core {
  constructor(target, base, step) {
    super();
    this.target = target;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doRecList(
      this.target.toLazy(env),
      this.base.type.toLazy(env),
      this.base.expr.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `(rec-List ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndList2 = class extends Core {
  constructor(target, motive, base, step) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doIndList(
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.base.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `(ind-List ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Trivial2 = class extends Core {
  valOf(_env) {
    return new Trivial();
  }
  prettyPrint() {
    return "Trivial";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Sole = class extends Core {
  valOf(_) {
    return new Sole2();
  }
  prettyPrint() {
    return "sole";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Absurd2 = class extends Core {
  valOf(_) {
    return new Absurd();
  }
  prettyPrint() {
    return "Absurd";
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndAbsurd2 = class extends Core {
  constructor(target, motive) {
    super();
    this.target = target;
    this.motive = motive;
  }
  valOf(env) {
    return doIndAbsurd(
      this.target.toLazy(env),
      this.motive.toLazy(env)
    );
  }
  prettyPrint() {
    return `(ind-Absurd 
              ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Equal2 = class extends Core {
  constructor(type, left, right) {
    super();
    this.type = type;
    this.left = left;
    this.right = right;
  }
  valOf(env) {
    return new Equal(
      this.type.toLazy(env),
      this.left.toLazy(env),
      this.right.toLazy(env)
    );
  }
  prettyPrint() {
    return `(= ${this.type.prettyPrint()} 
              ${this.left.prettyPrint()} 
              ${this.right.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Same2 = class extends Core {
  constructor(type) {
    super();
    this.type = type;
  }
  valOf(env) {
    return new Same(this.type.toLazy(env));
  }
  prettyPrint() {
    return `(same ${this.type.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Replace2 = class extends Core {
  constructor(target, motive, base) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
  }
  valOf(env) {
    return doReplace(
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.base.toLazy(env)
    );
  }
  prettyPrint() {
    return `(replace ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Trans = class extends Core {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  valOf(env) {
    return doTrans(
      this.left.toLazy(env),
      this.right.toLazy(env)
    );
  }
  prettyPrint() {
    return `(trans ${this.left.prettyPrint()} ${this.right.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cong2 = class extends Core {
  constructor(target, base, fun) {
    super();
    this.target = target;
    this.base = base;
    this.fun = fun;
  }
  valOf(env) {
    return doCong(
      this.target.toLazy(env),
      this.base.toLazy(env),
      this.fun.toLazy(env)
    );
  }
  prettyPrint() {
    return `(cong ${this.target.prettyPrint()} ${this.fun.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Symm2 = class extends Core {
  constructor(equality) {
    super();
    this.equality = equality;
  }
  valOf(env) {
    return doSymm(
      this.equality.toLazy(env)
    );
  }
  prettyPrint() {
    return `(symm ${this.equality.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndEqual2 = class extends Core {
  constructor(target, motive, base) {
    super();
    this.target = target;
    this.motive = motive;
    this.base = base;
  }
  valOf(env) {
    return doIndEqual(
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.base.toLazy(env)
    );
  }
  prettyPrint() {
    return `(ind-= ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Vec2 = class extends Core {
  constructor(type, length) {
    super();
    this.type = type;
    this.length = length;
  }
  valOf(env) {
    return new Vec(
      this.type.toLazy(env),
      this.length.toLazy(env)
    );
  }
  prettyPrint() {
    return `(Vec ${this.type.prettyPrint()} ${this.length.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var VecCons2 = class extends Core {
  constructor(head, tail) {
    super();
    this.head = head;
    this.tail = tail;
  }
  valOf(env) {
    return new VecCons(
      this.head.toLazy(env),
      this.tail.toLazy(env)
    );
  }
  prettyPrint() {
    return `(vec:: ${this.head.prettyPrint()} ${this.tail.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var VecNil2 = class extends Core {
  valOf(_) {
    return new VecNil();
  }
  prettyPrint() {
    return "vecnil";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Head2 = class extends Core {
  constructor(vec) {
    super();
    this.vec = vec;
  }
  valOf(env) {
    return doHead(this.vec.toLazy(env));
  }
  prettyPrint() {
    return `(head ${this.vec.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Tail2 = class extends Core {
  constructor(vec) {
    super();
    this.vec = vec;
  }
  valOf(env) {
    return doTail(this.vec.toLazy(env));
  }
  prettyPrint() {
    return `(tail ${this.vec.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndVec = class extends Core {
  constructor(length, target, motive, base, step) {
    super();
    this.length = length;
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  valOf(env) {
    return doIndVec(
      this.length.toLazy(env),
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.base.toLazy(env),
      this.step.toLazy(env)
    );
  }
  prettyPrint() {
    return `ind-Vec ${this.length.prettyPrint()}
              ${this.target.prettyPrint()}
              ${this.motive.prettyPrint()}
              ${this.base.prettyPrint()}
              ${this.step.prettyPrint()}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Either2 = class extends Core {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  valOf(env) {
    return new Either(this.left.toLazy(env), this.right.toLazy(env));
  }
  prettyPrint() {
    return `(Either ${this.left.prettyPrint()} ${this.right.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Left2 = class extends Core {
  constructor(value) {
    super();
    this.value = value;
  }
  valOf(env) {
    return new Left(this.value.toLazy(env));
  }
  prettyPrint() {
    return `(left ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Right2 = class extends Core {
  constructor(value) {
    super();
    this.value = value;
  }
  valOf(env) {
    return new Right(this.value.toLazy(env));
  }
  prettyPrint() {
    return `(right ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndEither2 = class extends Core {
  constructor(target, motive, baseLeft, baseRight) {
    super();
    this.target = target;
    this.motive = motive;
    this.baseLeft = baseLeft;
    this.baseRight = baseRight;
  }
  valOf(env) {
    return doIndEither(
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.baseLeft.toLazy(env),
      this.baseRight.toLazy(env)
    );
  }
  prettyPrint() {
    return `(ind-Either ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.baseLeft.prettyPrint()} 
              ${this.baseRight.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var TODO = class extends Core {
  constructor(loc, type) {
    super();
    this.loc = loc;
    this.type = type;
  }
  valOf(env) {
    return new Neutral(
      this.type.toLazy(env),
      new TODO2(this.loc, this.type.toLazy(env))
    );
  }
  prettyPrint() {
    return `TODO ${this.type.prettyPrint()}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Application2 = class extends Core {
  constructor(fun, arg) {
    super();
    this.fun = fun;
    this.arg = arg;
  }
  valOf(env) {
    return doApp(
      this.fun.toLazy(env),
      this.arg.toLazy(env)
    );
  }
  prettyPrint() {
    return `(${this.fun.prettyPrint()} ${this.arg.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var VarName = class extends Core {
  constructor(name) {
    super();
    this.name = name;
  }
  valOf(env) {
    if (isVarName(this.name)) {
      return getValueFromEnvironment(env, this.name);
    } else {
      throw new Error(`${this.name} is not a valid variable name`);
    }
  }
  prettyPrint() {
    return this.name;
  }
  toString() {
    return this.prettyPrint();
  }
};
var InductiveTypeConstructor3 = class extends Core {
  constructor(typeName, parameters, indices) {
    super();
    this.typeName = typeName;
    this.parameters = parameters;
    this.indices = indices;
  }
  valOf(env) {
    return new InductiveTypeConstructor2(
      this.typeName,
      this.parameters.map((p) => p.toLazy(env)),
      this.indices.map((i) => i.toLazy(env))
    );
  }
  prettyPrint() {
    return `${this.typeName}${this.parameters.length > 0 ? " " + this.parameters.map((p) => p.prettyPrint()).join(" ") : ""}${this.indices.length > 0 ? " " + this.indices.map((i) => i.prettyPrint()).join(" ") : ""}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var InductiveType2 = class extends Core {
  constructor(typeName, parameterTypes, indexTypes) {
    super();
    this.typeName = typeName;
    this.parameterTypes = parameterTypes;
    this.indexTypes = indexTypes;
  }
  valOf(env) {
    return new InductiveType3(
      this.typeName,
      this.parameterTypes.map((p) => p.toLazy(env)),
      this.indexTypes.map((i) => i.toLazy(env))
    );
  }
  prettyPrint() {
    return `${this.typeName}${this.parameterTypes.length > 0 ? " " + this.parameterTypes.map((p) => p.prettyPrint()).join(" ") : ""}${this.indexTypes.length > 0 ? " " + this.indexTypes.map((i) => i.prettyPrint()).join(" ") : ""}`;
  }
};
var Constructor2 = class extends Core {
  constructor(name, index, type, args, recursive_args) {
    super();
    this.name = name;
    this.index = index;
    this.type = type;
    this.args = args;
    this.recursive_args = recursive_args;
  }
  valOf(env) {
    return new Constructor(
      this.name,
      this.type,
      this.args.map((a) => a.toLazy(env)),
      this.index,
      this.recursive_args.map((a) => a.toLazy(env))
    );
  }
  prettyPrint() {
    const args = this.args.map((a) => a.prettyPrint()).join(" ");
    return `(${this.name}${args.length > 0 ? " " + args : ""})`;
  }
};
var ConstructorType2 = class extends Core {
  constructor(name, index, type, argTypes, rec_argTypes, resultType, argNames, rec_argNames) {
    super();
    this.name = name;
    this.index = index;
    this.type = type;
    this.argTypes = argTypes;
    this.rec_argTypes = rec_argTypes;
    this.resultType = resultType;
    this.argNames = argNames;
    this.rec_argNames = rec_argNames;
  }
  valOf(env) {
    return new ConstructorType(
      this.name,
      this.index,
      this.type,
      this.argTypes.map((a) => a.toLazy(env)),
      this.rec_argTypes.map((a) => a.toLazy(env)),
      this.resultType.toLazy(env),
      this.argNames,
      this.rec_argNames
    );
  }
  prettyPrint() {
    return `ConstructorType ${this.name} : ${this.argTypes.map((a) => a.prettyPrint()).join(" -> ")} -> ${this.resultType.prettyPrint()}`;
  }
};
var Eliminator = class extends Core {
  constructor(typeName, target, motive, methods, methodTypes, motiveType) {
    super();
    this.typeName = typeName;
    this.target = target;
    this.motive = motive;
    this.methods = methods;
    this.methodTypes = methodTypes;
    this.motiveType = motiveType;
  }
  valOf(env) {
    return doEliminator(
      this.typeName,
      this.target.toLazy(env),
      this.motive.toLazy(env),
      this.methods.map((m) => m.toLazy(env)),
      this.methodTypes ? this.methodTypes.map((t) => t.toLazy(env)) : void 0,
      this.motiveType ? this.motiveType.toLazy(env) : void 0
    );
  }
  prettyPrint() {
    const methods = this.methods.map((m) => m.prettyPrint()).join(" ");
    return `(ind-${this.typeName} ${this.target.prettyPrint()} ${this.motive.prettyPrint()} ${methods})`;
  }
};

// src/pie_interpreter/utils/fresh.ts
var subscriptReplacements = {
  "0": "\u2080",
  "1": "\u2081",
  "2": "\u2082",
  "3": "\u2083",
  "4": "\u2084",
  "5": "\u2085",
  "6": "\u2086",
  "7": "\u2087",
  "8": "\u2088",
  "9": "\u2089"
};
var nonSubscripts = {
  "\u2080": "0",
  "\u2081": "1",
  "\u2082": "2",
  "\u2083": "3",
  "\u2084": "4",
  "\u2085": "5",
  "\u2086": "6",
  "\u2087": "7",
  "\u2088": "8",
  "\u2089": "9"
};
function freshen(used, x) {
  if (used.some((usedName) => usedName === x)) {
    const split = splitName(x);
    return freshenAux(used, split);
  }
  return x;
}
function freshenAux(used, split) {
  const joined = unsplitName(split);
  if (used.map((sym) => sym.toString()).includes(joined.toString())) {
    return freshenAux(used, nextSplitName(split));
  }
  return joined;
}
function isSubscriptDigit(c) {
  return Object.keys(nonSubscripts).includes(c);
}
function numberToSubscriptString(n) {
  const subscriptStr = n.toString().split("").map((digit) => subscriptReplacements[digit] || digit).join("");
  return subscriptStr;
}
function subscriptToNumber(str) {
  const replaced = str.split("").map((char) => nonSubscripts[char] || char).join("");
  return parseInt(replaced, 10) || 1;
}
function splitNameAux(str, i) {
  if (i < 0) {
    return [str, 0];
  }
  if (isSubscriptDigit(str[i])) {
    return splitNameAux(str, i - 1);
  }
  return [str.substring(0, i + 1), subscriptToNumber(str.substring(i + 1))];
}
function nextSplitName(split) {
  return [split[0], split[1] + 1];
}
function splitName(name) {
  const [base, num] = splitNameAux(name, name.length - 1);
  return [base, num];
}
function unsplitName([base, num]) {
  const subscriptStr = numberToSubscriptString(num);
  return base + subscriptStr;
}

// src/pie_interpreter/types/utils.ts
var SiteBinder = class {
  constructor(location, varName) {
    this.location = location;
    this.varName = varName;
  }
  prettyPrint() {
    return `${this.varName}`;
  }
};
var TypedBinder = class {
  constructor(binder, type) {
    this.binder = binder;
    this.type = type;
  }
  prettyPrint() {
    return `${this.binder.prettyPrint()} : ${this.type.prettyPrint()}`;
  }
  findNames() {
    return this.binder.varName;
  }
};
function isPieKeywords(str) {
  return str === "U" ? true : str === "Nat" ? true : str === "zero" ? true : str === "add1" ? true : str === "which-Nat" ? true : str === "iter-Nat" ? true : str === "rec-Nat" ? true : str === "ind-Nat" ? true : str === "->" ? true : str === "\u2192" ? true : str === "\u03A0" ? true : str === "\u03BB" ? true : str === "Pi" ? true : str === "\u220F" ? true : str === "lambda" ? true : str === "quote" ? true : str === "Atom" ? true : str === "car" ? true : str === "cdr" ? true : str === "cons" ? true : str === "\u03A3" ? true : str === "Sigma" ? true : str === "Pair" ? true : str === "Trivial" ? true : str === "sole" ? true : str === "List" ? true : str === "::" ? true : str === "nil" ? true : str === "rec-List" ? true : str === "ind-List" ? true : str === "Absurd" ? true : str === "ind-Absurd" ? true : str === "=" ? true : str === "same" ? true : str === "replace" ? true : str === "trans" ? true : str === "cong" ? true : str === "symm" ? true : str === "ind-=" ? true : str === "Vec" ? true : str === "vecnil" ? true : str === "vec::" ? true : str === "head" ? true : str === "tail" ? true : str === "ind-Vec" ? true : str === "Either" ? true : str === "left" ? true : str === "right" ? true : str === "ind-Either" ? true : str === "TODO" ? true : str === "the" ? true : false;
}
var Message = class {
  constructor(message) {
    this.message = message;
  }
  toString() {
    return this.message.map((m) => typeof m === "string" ? m : m.prettyPrint()).join(" ");
  }
};
var Perhaps4 = class {
  // eslint-disable-line @typescript-eslint/no-unused-vars
};
var go = class extends Perhaps4 {
  constructor(result) {
    super();
    this.result = result;
  }
};
var stop = class extends Perhaps4 {
  constructor(where, message) {
    super();
    this.where = where;
    this.message = message;
  }
};
var PerhapsM = class {
  // name is majorly for debugging use.
  constructor(name, value = null) {
    this.name = name;
    this.value = value;
  }
};
function goOn(bindings, finalExpr) {
  for (const [meta, lazy] of bindings) {
    const val = lazy();
    if (val instanceof go) {
      meta.value = val.result;
    } else {
      if (val instanceof stop) {
        throw new Error(`Error: ${val.message.toString()} at ${val.where}`);
      }
      throw new Error(`Internal error: expected go/stop, got ${typeof val}`);
    }
  }
  return finalExpr();
}
var Closure = class {
  constructor() {
  }
};
var FirstOrderClosure = class extends Closure {
  constructor(env, varName, expr) {
    super();
    this.env = env;
    this.varName = varName;
    this.expr = expr;
  }
  valOfClosure(v) {
    return this.expr.valOf(extendEnvironment(this.env, this.varName, v));
  }
  prettyPrint() {
    return `(CLOS ${this.varName} ${this.expr.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var HigherOrderClosure = class extends Closure {
  constructor(proc) {
    super();
    this.proc = proc;
  }
  valOfClosure(v) {
    return this.proc(v);
  }
  prettyPrint() {
    return this.proc.toString();
  }
  toString() {
    return this.prettyPrint();
  }
};
function isVarName(name) {
  return !isPieKeywords(name) && isNaN(Number(name));
}
function namesInContext(ctx) {
  return Array.from(ctx.keys());
}
function fresh(ctx, name) {
  return freshen(namesInContext(ctx), name);
}
function freshBinder(ctx, src, name) {
  return freshen(namesInContext(ctx).concat(src.findNames()), name);
}
function occurringBinderNames(binder) {
  return [binder.binder.varName].concat(binder.type.findNames());
}
function extractVarNamesFromValue(val) {
  const names = [];
  collectVarNames(val, names);
  return names;
}
function collectVarNames(val, names) {
  if (val instanceof Delay) {
    const boxContent = val.val.get();
    if (boxContent instanceof DelayClosure) {
      collectVarNamesFromCore(boxContent.expr, names);
      return;
    } else {
      val = boxContent;
    }
  }
  const valNow = val.now();
  if (valNow instanceof Neutral && valNow.neutral instanceof Variable) {
    if (!names.includes(valNow.neutral.name)) {
      names.push(valNow.neutral.name);
    }
  } else if (valNow instanceof Add1) {
    collectVarNames(valNow.smaller, names);
  } else if (valNow instanceof InductiveTypeConstructor2) {
    valNow.parameters.forEach((p) => collectVarNames(p, names));
    valNow.indices.forEach((i) => collectVarNames(i, names));
  }
}
function collectVarNamesFromCore(core, names) {
  if (core instanceof VarName) {
    if (!names.includes(core.name)) {
      names.push(core.name);
    }
  } else if (core instanceof Add12) {
    collectVarNamesFromCore(core.n, names);
  } else if (core instanceof InductiveTypeConstructor3) {
    core.parameters.forEach((p) => collectVarNamesFromCore(p, names));
    core.indices.forEach((i) => collectVarNamesFromCore(i, names));
  }
}

// src/pie_interpreter/utils/alphaeqv.ts
function alphaEquiv(e1, e2) {
  return alphaEquivAux(0, /* @__PURE__ */ new Map(), /* @__PURE__ */ new Map(), e1, e2);
}
var FV = -1;
function bind(b, x, lvl) {
  return b.set(x, lvl);
}
function findBinding(x, b) {
  if (b.has(x)) {
    return b.get(x);
  }
  return FV;
}
function alphaEquivAux(lvl, b1, b2, e1, e2) {
  if (e1 instanceof VarName && e2 instanceof VarName) {
    const n1 = e1.name;
    const n2 = e2.name;
    if (isVarName(n1) && isVarName(n2)) {
      const xBinding = findBinding(n1, b1);
      const yBinding = findBinding(n2, b2);
      if (xBinding !== FV && yBinding !== FV) {
        return xBinding === yBinding;
      } else if (xBinding === FV && yBinding === FV) {
        return n1 === n2;
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else if (e1 instanceof Quote2 && e2 instanceof Quote2) {
    return e1.sym === e2.sym;
  } else if (e1 instanceof Pi2 && e2 instanceof Pi2) {
    return alphaEquivAux(lvl, b1, b2, e1.type, e2.type) && alphaEquivAux(lvl + 1, bind(b1, e1.name, lvl), bind(b2, e2.name, lvl), e1.body, e2.body);
  } else if (e1 instanceof Sigma2 && e2 instanceof Sigma2) {
    return alphaEquivAux(lvl, b1, b2, e1.type, e2.type) && alphaEquivAux(lvl + 1, bind(b1, e1.name, lvl), bind(b2, e2.name, lvl), e1.body, e2.body);
  } else if (e1 instanceof Lambda2 && e2 instanceof Lambda2) {
    return alphaEquivAux(
      lvl + 1,
      bind(b1, e1.param, lvl),
      bind(b2, e2.param, lvl),
      e1.body,
      e2.body
    );
  } else if (e1 instanceof The && e2 instanceof The && e1.type instanceof Absurd2 && e2.type instanceof Absurd2) {
    return true;
  } else if (e1 instanceof Application2 && e2 instanceof Application2) {
    return alphaEquivAux(lvl, b1, b2, e1.fun, e2.fun) && alphaEquivAux(lvl, b1, b2, e1.arg, e2.arg);
  } else if (e1 instanceof Universe2 && e2 instanceof Universe2 || e1 instanceof Nat2 && e2 instanceof Nat2 || e1 instanceof Zero2 && e2 instanceof Zero2 || e1 instanceof Atom2 && e2 instanceof Atom2 || e1 instanceof Absurd2 && e2 instanceof Absurd2 || e1 instanceof Sole && e2 instanceof Sole || e1 instanceof Nil2 && e2 instanceof Nil2 || e1 instanceof VecNil2 && e2 instanceof VecNil2 || e1 instanceof Trivial2 && e2 instanceof Trivial2) {
    return true;
  } else if (e1 instanceof The && e2 instanceof The) {
    return alphaEquivAux(lvl, b1, b2, e1.type, e2.type) && alphaEquivAux(lvl, b1, b2, e1.expr, e2.expr);
  } else if (e1 instanceof List2 && e2 instanceof List2) {
    return alphaEquivAux(lvl, b1, b2, e1.elemType, e2.elemType);
  } else if (e1 instanceof Add12 && e2 instanceof Add12) {
    return alphaEquivAux(lvl, b1, b2, e1.n, e2.n);
  } else if (e1 instanceof WhichNat2 && e2 instanceof WhichNat2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof IterNat2 && e2 instanceof IterNat2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof RecNat2 && e2 instanceof RecNat2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof IndNat2 && e2 instanceof IndNat2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof Cons2 && e2 instanceof Cons2) {
    return alphaEquivAux(lvl, b1, b2, e1.first, e2.first) && alphaEquivAux(lvl, b1, b2, e1.second, e2.second);
  } else if (e1 instanceof Car2 && e2 instanceof Car2) {
    return alphaEquivAux(lvl, b1, b2, e1.pair, e2.pair);
  } else if (e1 instanceof Cdr2 && e2 instanceof Cdr2) {
    return alphaEquivAux(lvl, b1, b2, e1.pair, e2.pair);
  } else if (e1 instanceof ListCons2 && e2 instanceof ListCons2) {
    return alphaEquivAux(lvl, b1, b2, e1.head, e2.head) && alphaEquivAux(lvl, b1, b2, e1.tail, e2.tail);
  } else if (e1 instanceof RecList2 && e2 instanceof RecList2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof IndList2 && e2 instanceof IndList2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof IndAbsurd2 && e2 instanceof IndAbsurd2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive);
  } else if (e1 instanceof Equal2 && e2 instanceof Equal2) {
    return alphaEquivAux(lvl, b1, b2, e1.type, e2.type) && alphaEquivAux(lvl, b1, b2, e1.left, e2.left) && alphaEquivAux(lvl, b1, b2, e1.right, e2.right);
  } else if (e1 instanceof Same2 && e2 instanceof Same2) {
    return alphaEquivAux(lvl, b1, b2, e1.type, e2.type);
  } else if (e1 instanceof Replace2 && e2 instanceof Replace2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base);
  } else if (e1 instanceof Trans && e2 instanceof Trans) {
    return alphaEquivAux(lvl, b1, b2, e1.left, e2.left) && alphaEquivAux(lvl, b1, b2, e1.right, e2.right);
  } else if (e1 instanceof Cong2 && e2 instanceof Cong2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.fun, e2.fun);
  } else if (e1 instanceof Symm2 && e2 instanceof Symm2) {
    return alphaEquivAux(lvl, b1, b2, e1.equality, e2.equality);
  } else if (e1 instanceof IndEqual2 && e2 instanceof IndEqual2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base);
  } else if (e1 instanceof Vec2 && e2 instanceof Vec2) {
    return alphaEquivAux(lvl, b1, b2, e1.type, e2.type) && alphaEquivAux(lvl, b1, b2, e1.length, e2.length);
  } else if (e1 instanceof VecCons2 && e2 instanceof VecCons2) {
    return alphaEquivAux(lvl, b1, b2, e1.head, e2.head) && alphaEquivAux(lvl, b1, b2, e1.tail, e2.tail);
  } else if (e1 instanceof Head2 && e2 instanceof Head2) {
    return alphaEquivAux(lvl, b1, b2, e1.vec, e2.vec);
  } else if (e1 instanceof Tail2 && e2 instanceof Tail2) {
    return alphaEquivAux(lvl, b1, b2, e1.vec, e2.vec);
  } else if (e1 instanceof IndVec && e2 instanceof IndVec) {
    return alphaEquivAux(lvl, b1, b2, e1.length, e2.length) && alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive) && alphaEquivAux(lvl, b1, b2, e1.base, e2.base) && alphaEquivAux(lvl, b1, b2, e1.step, e2.step);
  } else if (e1 instanceof Either2 && e2 instanceof Either2) {
    return alphaEquivAux(lvl, b1, b2, e1.left, e2.left) && alphaEquivAux(lvl, b1, b2, e1.right, e2.right);
  } else if (e1 instanceof Left2 && e2 instanceof Left2) {
    return alphaEquivAux(lvl, b1, b2, e1.value, e2.value);
  } else if (e1 instanceof Right2 && e2 instanceof Right2) {
    return alphaEquivAux(lvl, b1, b2, e1.value, e2.value);
  } else if (e1 instanceof IndEither2 && e2 instanceof IndEither2) {
    return alphaEquivAux(lvl, b1, b2, e1.target, e2.target) && alphaEquivAux(lvl, b1, b2, e1.motive, e2.motive) && alphaEquivAux(lvl, b1, b2, e1.baseLeft, e2.baseLeft) && alphaEquivAux(lvl, b1, b2, e1.baseRight, e2.baseRight);
  } else if (e1 instanceof TODO && e2 instanceof TODO) {
    return sameLocation(e1.loc, e2.loc) && alphaEquivAux(lvl, b1, b2, e1.type, e2.type);
  } else if (e1 instanceof InductiveTypeConstructor3 && e2 instanceof InductiveTypeConstructor3) {
    if (e1.typeName !== e2.typeName) return false;
    if (e1.parameters.length !== e2.parameters.length) return false;
    if (e1.indices.length !== e2.indices.length) return false;
    for (let i = 0; i < e1.parameters.length; i++) {
      if (!alphaEquivAux(lvl, b1, b2, e1.parameters[i], e2.parameters[i])) return false;
    }
    for (let i = 0; i < e1.indices.length; i++) {
      if (!alphaEquivAux(lvl, b1, b2, e1.indices[i], e2.indices[i])) return false;
    }
    return true;
  } else {
    return false;
  }
}
function sameLocation(e1, e2) {
  return e1.startLine === e2.startLine && e1.startColumn === e2.startColumn && e1.endLine === e2.endLine && e1.endColumn === e2.endColumn;
}

// src/pie_interpreter/solver/todo_solver.ts
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
var MISSING_API_KEY_ERROR = new Error(
  "GOOGLE_API_KEY environment variable is not set. Please create a .env file in the project root with: GOOGLE_API_KEY=your_key_here"
);
var todoQueue = [];

// src/pie_interpreter/typechecker/utils.ts
function PieInfoHook(where, what) {
  if (Array.isArray(what) && what[0] === "TODO") {
    const [_, serializedCtx, expectedTypeCore, renaming] = what;
    const ctx = /* @__PURE__ */ new Map();
    const expectedTypeValue = expectedTypeCore.valOf(/* @__PURE__ */ new Map());
    todoQueue.push({
      location: where,
      context: ctx,
      expectedType: expectedTypeValue,
      renaming
    });
  }
}
function SendPieInfo(where, what) {
  if (where.forInfo) {
    PieInfoHook(where, what);
  }
}
function rename(renames, x) {
  const rename2 = renames.get(x);
  return rename2 ? rename2 : x;
}
function extendRenaming(renames, from, to) {
  const newRenames = new Map([[from, to], ...renames]);
  return newRenames;
}
function sameType(ctx, where, given, expected) {
  const givenE = given.readBackType(ctx);
  const expectedE = expected.readBackType(ctx);
  if (alphaEquiv(givenE, expectedE)) {
    return new go(void 0);
  } else {
    return new stop(
      where,
      new Message([`Expected ${expectedE} but got ${givenE}`])
    );
  }
}
function convert(ctx, where, type, from, to) {
  const fromE = readBack(ctx, type, from);
  const toE = readBack(ctx, type, to);
  if (alphaEquiv(fromE, toE)) {
    return new go(void 0);
  } else {
    return new stop(
      where,
      new Message([`The terms ${from.prettyPrint()} and ${to.prettyPrint()} are not the same ${type.prettyPrint()}.`])
    );
  }
}
function atomOk(a) {
  return allOkAtom(a.split(""));
}
function allOkAtom(cs) {
  if (cs.length === 0) {
    return true;
  } else if (isAlphabetic(cs[0]) || cs[0] === "-") {
    return allOkAtom(cs.slice(1));
  } else {
    return false;
  }
}
function isAlphabetic(char) {
  return /^[a-zA-Z]$/.test(char);
}
function makeApp(a, b, cs) {
  return new Application3(a.location, a, b, cs);
}

// src/pie_interpreter/typechecker/synthesizer.ts
var synthesizer = class {
  static synthNat(ctx, r) {
    return new go(new The(
      new Universe2(),
      new Nat2()
    ));
  }
  static synthUniverse(ctx, r, location) {
    return new stop(
      location,
      new Message(["U is a type, but it does not have a type."])
    );
  }
  static synthArrow(context, r, location, arg1, arg2, args) {
    if (args.length === 0) {
      const z = freshBinder(context, arg2, "x");
      const Aout = new PerhapsM("Aout");
      const Bout = new PerhapsM("Bout");
      return goOn(
        [
          [Aout, () => arg1.check(context, r, new Universe())],
          [
            Bout,
            () => arg2.check(
              bindFree(context, z, valInContext(context, Aout.value)),
              r,
              new Universe()
            )
          ]
        ],
        (() => {
          return new go(
            new The(
              new Universe2(),
              new Pi2(
                z,
                Aout.value,
                Bout.value
              )
            )
          );
        })
      );
    } else {
      const [first, ...rest] = args;
      const z = freshBinder(context, makeApp(arg2, first, rest), "x");
      const Aout = new PerhapsM("Aout");
      const tout = new PerhapsM("tout");
      return goOn(
        [
          [Aout, () => arg1.check(context, r, new Universe())],
          [
            tout,
            () => new Arrow(notForInfo(location), arg2, first, rest).check(
              bindFree(context, z, valInContext(context, Aout.value)),
              r,
              new Universe()
            )
          ]
        ],
        () => {
          return new go(
            new The(
              new Universe2(),
              new Pi2(
                z,
                Aout.value,
                tout.value
              )
            )
          );
        }
      );
    }
  }
  static synthPi(context, r, location, binders, body) {
    if (binders.length === 1) {
      const [binder, type] = [binders[0].binder, binders[0].type];
      const xhat = fresh(context, binder.varName);
      const xloc = binder.location;
      const Aout = new PerhapsM("Aout");
      const Bout = new PerhapsM("Bout");
      return goOn(
        [
          [Aout, () => type.check(context, r, new Universe())],
          [Bout, () => body.check(
            bindFree(context, xhat, valInContext(context, Aout.value)),
            extendRenaming(r, binder.varName, xhat),
            new Universe()
          )]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new The(
              new Universe2(),
              new Pi2(
                xhat,
                Aout.value,
                Bout.value
              )
            )
          );
        }
      );
    } else if (binders.length > 1) {
      const [fst, ...rest] = binders;
      const [binder, type] = [fst.binder, fst.type];
      const xloc = binder.location;
      const x = binder.varName;
      const xhat = fresh(context, x);
      const Aout = new PerhapsM("Aout");
      const Bout = new PerhapsM("Bout");
      return goOn(
        [
          [Aout, () => type.check(context, r, new Universe())],
          [
            Bout,
            () => new Pi3(notForInfo(location), rest, body).check(
              bindFree(context, xhat, valInContext(context, Aout.value)),
              extendRenaming(r, x, xhat),
              new Universe()
            )
          ]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new The(
              new Universe2(),
              new Pi2(
                xhat,
                Aout.value,
                Bout.value
              )
            )
          );
        }
      );
    } else {
      throw new Error("Invalid number of binders in Pi type");
    }
  }
  static synthZero(context, r) {
    return new go(
      new The(
        new Nat2(),
        new Zero2()
      )
    );
  }
  static synthAdd1(context, r, base) {
    const nout = new PerhapsM("nout");
    return goOn(
      [[nout, () => base.check(context, r, new Nat())]],
      () => new go(
        new The(
          new Nat2(),
          new Add12(nout.value)
        )
      )
    );
  }
  static synthWhichNat(context, r, target, base, step) {
    const tgtout = new PerhapsM("tgtout");
    const bout = new PerhapsM("bout");
    const sout = new PerhapsM("sout");
    const n_minus_1 = fresh(context, "n_minus_1");
    return goOn(
      [
        [tgtout, () => target.check(context, r, new Nat())],
        [bout, () => base.synth(context, r)],
        [
          sout,
          () => step.check(
            context,
            r,
            new Pi(
              n_minus_1,
              new Nat(),
              new FirstOrderClosure(
                contextToEnvironment(context),
                n_minus_1,
                bout.value.type
              )
            )
          )
        ]
      ],
      () => new go(
        new The(
          bout.value.type,
          new WhichNat2(
            tgtout.value,
            new The(
              bout.value.type,
              bout.value.expr
            ),
            sout.value
          )
        )
      )
    );
  }
  static synthIterNat(context, r, target, base, step) {
    const tgtout = new PerhapsM("tgtout");
    const bout = new PerhapsM("bout");
    const sout = new PerhapsM("sout");
    return goOn(
      [
        [tgtout, () => target.check(context, r, new Nat())],
        [bout, () => base.synth(context, r)],
        [sout, () => step.check(
          context,
          r,
          (() => {
            const old = fresh(context, "old");
            return valInContext(
              context,
              new Pi2(
                old,
                bout.value.type,
                bout.value.type
              )
            );
          })()
        )]
      ],
      () => new go(
        new The(
          bout.value.type,
          new IterNat2(
            tgtout.value,
            new The(
              bout.value.type,
              bout.value.expr
            ),
            sout.value
          )
        )
      )
    );
  }
  static synthRecNat(context, r, target, base, step) {
    const tgtout = new PerhapsM("tgtout");
    const bout = new PerhapsM("bout");
    const sout = new PerhapsM("sout");
    return goOn(
      [
        [tgtout, () => target.check(context, r, new Nat())],
        [bout, () => base.synth(context, r)],
        [sout, () => step.check(
          context,
          r,
          (() => {
            const n_minus_1 = fresh(context, "n_minus_1");
            const old = fresh(context, "old");
            return valInContext(
              context,
              new Pi2(
                n_minus_1,
                new Nat2(),
                new Pi2(
                  old,
                  bout.value.type,
                  bout.value.type
                )
              )
            );
          })()
        )]
      ],
      () => new go(
        new The(
          bout.value.type,
          new RecNat2(
            tgtout.value,
            new The(
              bout.value.type,
              bout.value.expr
            ),
            sout.value
          )
        )
      )
    );
  }
  static synthIndNat(context, r, target, motive, base, step) {
    const tgtout = new PerhapsM("tgtout");
    const motout = new PerhapsM("motout");
    const motval = new PerhapsM("motval");
    const bout = new PerhapsM("bout");
    const sout = new PerhapsM("sout");
    return goOn(
      [
        [tgtout, () => target.check(context, r, new Nat())],
        [motout, () => motive.check(
          context,
          r,
          new Pi(
            "n",
            new Nat(),
            new HigherOrderClosure((_) => new Universe())
          )
        )],
        [motval, () => new go(
          valInContext(context, motout.value)
        )],
        [bout, () => base.check(
          context,
          r,
          doApp(motval.value, new Zero())
        )],
        [sout, () => step.check(
          context,
          r,
          new Pi(
            "n-1",
            new Nat(),
            new HigherOrderClosure(
              (n_minus_1) => new Pi(
                "x",
                doApp(motval.value, n_minus_1),
                new HigherOrderClosure(
                  (_) => doApp(motval.value, new Add1(n_minus_1))
                )
              )
            )
          )
        )]
      ],
      () => new go(
        new The(
          new Application2(
            motout.value,
            tgtout.value
          ),
          new IndNat2(
            tgtout.value,
            motout.value,
            bout.value,
            sout.value
          )
        )
      )
    );
  }
  static synthAtom(context, r) {
    return new go(
      new The(
        new Universe2(),
        new Atom2()
      )
    );
  }
  static synthPair(context, r, first, second) {
    const a = fresh(context, "a");
    const Aout = new PerhapsM("Aout");
    const Dout = new PerhapsM("Dout");
    return goOn(
      [
        [Aout, () => first.check(context, r, new Universe())],
        [Dout, () => second.check(
          bindFree(context, a, valInContext(context, Aout.value)),
          r,
          new Universe()
        )]
      ],
      () => new go(
        new The(
          new Universe2(),
          new Sigma2(
            a,
            Aout.value,
            Dout.value
          )
        )
      )
    );
  }
  static synthSigma(context, r, location, binders, body) {
    if (binders.length === 1) {
      const [bd, type] = [binders[0].binder, binders[0].type];
      const xhat = fresh(context, bd.varName);
      const xloc = bd.location;
      const Aout = new PerhapsM("Aout");
      const Dout = new PerhapsM("Dout");
      return goOn(
        [
          [Aout, () => type.check(context, r, new Universe())],
          [Dout, () => body.check(
            bindFree(context, xhat, valInContext(context, Aout.value)),
            extendRenaming(r, bd.varName, xhat),
            new Universe()
          )]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new The(
              new Universe2(),
              new Sigma2(
                xhat,
                Aout.value,
                Dout.value
              )
            )
          );
        }
      );
    } else if (binders.length > 1) {
      const [fst, ...rest] = binders;
      const [binder, type] = [fst.binder, fst.type];
      const xloc = binder.location;
      const x = binder.varName;
      const xhat = fresh(context, x);
      const Aout = new PerhapsM("Aout");
      const Dout = new PerhapsM("Dout");
      return goOn(
        [
          [Aout, () => type.check(context, r, new Universe())],
          [
            Dout,
            () => new Sigma3(
              notForInfo(location),
              rest,
              body
            ).check(
              bindFree(context, xhat, valInContext(context, Aout.value)),
              extendRenaming(r, x, xhat),
              new Universe()
            )
          ]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new The(
              new Universe2(),
              new Sigma2(
                xhat,
                Aout.value,
                Dout.value
              )
            )
          );
        }
      );
    } else {
      throw new Error("Invalid number of binders in Sigma type");
    }
  }
  static synthCar(context, r, location, pair) {
    const pout = new PerhapsM("p_rst");
    return goOn(
      [[pout, () => pair.synth(context, r)]],
      () => {
        const val = valInContext(context, pout.value.type);
        if (val instanceof Sigma) {
          return new go(
            new The(
              val.carType.readBackType(context),
              new Car2(
                pout.value.expr
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`car requires a Pair type, but was used as a: ${val}.`])
          );
        }
      }
    );
  }
  static synthCdr(context, r, location, pair) {
    const pout = new PerhapsM("pout");
    return goOn(
      [[pout, () => pair.synth(context, r)]],
      () => {
        const val = valInContext(context, pout.value.type);
        if (val instanceof Sigma) {
          const [x, A, clos] = [val.carName, val.carType, val.cdrType];
          return new go(
            new The(
              clos.valOfClosure(
                doCar(valInContext(context, pout.value.expr))
              ).readBackType(context),
              new Cdr2(
                pout.value.expr
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`cdr requires a Pair type, but was used as a: ${val}.`])
          );
        }
      }
    );
  }
  static synthQuote(context, r, location, atom) {
    if (atomOk(atom)) {
      return new go(
        new The(
          new Atom2(),
          new Quote2(atom)
        )
      );
    } else {
      return new stop(
        location,
        new Message([`Invalid atom: ${atom}. Atoms consist of letters and hyphens.`])
      );
    }
  }
  static synthTrivial(context, r) {
    return new go(
      new The(
        new Universe2(),
        new Trivial2()
      )
    );
  }
  static synthSole(context, r) {
    return new go(
      new The(
        new Trivial2(),
        new Sole()
      )
    );
  }
  static synthIndList(context, r, location, target, motive, base, step) {
    const tgtout = new PerhapsM("tgtout");
    const motout = new PerhapsM("motout");
    const motval = new PerhapsM("motval");
    const bout = new PerhapsM("bout");
    const sout = new PerhapsM("sout");
    return goOn(
      [
        [tgtout, () => target.synth(context, r)]
      ],
      (() => {
        const [tgt_t, tgt_e] = [tgtout.value.type, tgtout.value.expr];
        const type = valInContext(context, tgt_t);
        if (type instanceof List) {
          const E2 = type.entryType;
          return goOn(
            [
              [
                motout,
                () => motive.check(
                  context,
                  r,
                  new Pi(
                    "xs",
                    new List(E2),
                    new FirstOrderClosure(
                      contextToEnvironment(context),
                      "xs",
                      new Universe2()
                    )
                  )
                )
              ],
              [motval, () => new go(valInContext(context, motout.value))],
              [bout, () => base.check(
                context,
                r,
                doApp(motval.value, new Nil())
              )],
              [sout, () => step.check(
                context,
                r,
                new Pi(
                  "e",
                  E2,
                  new HigherOrderClosure(
                    (e) => new Pi(
                      "es",
                      new List(E2),
                      new HigherOrderClosure(
                        (es) => new Pi(
                          "ih",
                          doApp(motval.value, es),
                          new HigherOrderClosure(
                            (_) => doApp(motval.value, new ListCons(e, es))
                          )
                        )
                      )
                    )
                  )
                )
              )]
            ],
            () => new go(
              new The(
                new Application2(
                  motout.value,
                  tgt_e
                ),
                new IndList2(
                  tgt_e,
                  motout.value,
                  bout.value,
                  sout.value
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Not a List: ${type.readBackType(context)}.`])
          );
        }
      })
    );
  }
  static synthRecList(context, r, location, target, base, step) {
    const tgtout = new PerhapsM("tgtout");
    return goOn(
      [[tgtout, () => target.synth(context, r)]],
      () => {
        const [tgt_t, tgt_e] = [tgtout.value.type, tgtout.value.expr];
        const type = valInContext(context, tgt_t);
        if (type instanceof List) {
          const E2 = type.entryType;
          const bout = new PerhapsM("bout");
          const btval = new PerhapsM("btval");
          const sout = new PerhapsM("sout");
          return goOn(
            [
              [bout, () => base.synth(context, r)],
              [btval, () => new go(valInContext(context, bout.value.type))],
              [
                sout,
                () => step.check(
                  context,
                  r,
                  new Pi(
                    "e",
                    E2,
                    new HigherOrderClosure(
                      (_) => new Pi(
                        "es",
                        new List(E2),
                        new HigherOrderClosure(
                          (_2) => new Pi(
                            "ih",
                            btval.value,
                            new HigherOrderClosure(
                              (_3) => btval.value
                            )
                          )
                        )
                      )
                    )
                  )
                )
              ]
            ],
            () => new go(
              new The(
                bout.value.type,
                new RecList2(
                  tgt_e,
                  new The(
                    bout.value.type,
                    bout.value.expr
                  ),
                  sout.value
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Not a List: ${type.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthList(context, r, e) {
    const Eout = new PerhapsM("Eout");
    return goOn(
      [[Eout, () => e.entryType.check(context, r, new Universe())]],
      () => new go(
        new The(
          new Universe2(),
          new List2(Eout.value)
        )
      )
    );
  }
  static synthListCons(context, r, x, xs) {
    const fstout = new PerhapsM("eout");
    const restout = new PerhapsM("esout");
    return goOn(
      [
        [fstout, () => x.synth(context, r)],
        [
          restout,
          () => xs.check(
            context,
            r,
            valInContext(context, new List2(fstout.value.type))
          )
        ]
      ],
      () => new go(
        new The(
          new List2(fstout.value.type),
          new ListCons2(
            fstout.value.expr,
            restout.value
          )
        )
      )
    );
  }
  static synthAbsurd(context, r, e) {
    return new go(
      new The(
        new Universe2(),
        new Absurd2()
      )
    );
  }
  static synthIndAbsurd(context, r, e) {
    const tgtout = new PerhapsM("tgtout");
    const motout = new PerhapsM("motout");
    return goOn(
      [
        [tgtout, () => e.target.check(context, r, new Absurd())],
        [motout, () => e.motive.check(context, r, new Universe())]
      ],
      () => new go(
        new The(
          motout.value,
          new IndAbsurd2(
            tgtout.value,
            motout.value
          )
        )
      )
    );
  }
  static synthEqual(context, r, type, left, right) {
    const Aout = new PerhapsM("Aout");
    const Av = new PerhapsM("Av");
    const from_out = new PerhapsM("from_out");
    const to_out = new PerhapsM("to_out");
    return goOn(
      [
        [Aout, () => type.check(context, r, new Universe())],
        [Av, () => new go(valInContext(context, Aout.value))],
        [from_out, () => left.check(context, r, Av.value)],
        [to_out, () => right.check(context, r, Av.value)]
      ],
      () => new go(
        new The(
          new Universe2(),
          new Equal2(
            Aout.value,
            from_out.value,
            to_out.value
          )
        )
      )
    );
  }
  static synthReplace(context, r, location, target, motive, base) {
    const tgtout = new PerhapsM("tgt_rst");
    const motout = new PerhapsM("motout");
    const bout = new PerhapsM("bout");
    return goOn(
      [[tgtout, () => target.synth(context, r)]],
      () => {
        const result = valInContext(context, tgtout.value.type);
        if (result instanceof Equal) {
          const [Av, fromv, tov] = [result.type, result.from, result.to];
          return goOn(
            [
              [
                motout,
                () => motive.check(
                  context,
                  r,
                  new Pi(
                    "x",
                    Av,
                    new HigherOrderClosure(
                      (_) => new Universe()
                    )
                  )
                )
              ],
              [bout, () => base.check(
                context,
                r,
                doApp(valInContext(context, motout.value), fromv)
              )]
            ],
            () => new go(
              new The(
                doApp(valInContext(context, motout.value), tov).readBackType(context),
                new Replace2(
                  tgtout.value.expr,
                  motout.value,
                  bout.value
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Expected an expression with = type, but the type was: ${tgtout.value.type}.`])
          );
        }
      }
    );
  }
  static synthTrans(context, r, location, left, right) {
    const lout = new PerhapsM("p1_rst");
    const rout = new PerhapsM("p2_rst");
    return goOn(
      [
        [lout, () => left.synth(context, r)],
        [rout, () => right.synth(context, r)]
      ],
      () => {
        const result1 = valInContext(context, lout.value.type);
        const result2 = valInContext(context, rout.value.type);
        if (result1 instanceof Equal && result2 instanceof Equal) {
          const [Av, fromv, midv] = [result1.type, result1.from, result1.to];
          const [Bv, midv2, tov] = [result2.type, result2.from, result2.to];
          return goOn(
            [
              [new PerhapsM("_"), () => sameType(context, location, Av, Bv)],
              [new PerhapsM("_"), () => convert(context, location, Av, midv, midv2)]
            ],
            () => new go(
              new The(
                new Equal(Av, fromv, tov).readBackType(context),
                new Trans(
                  lout.value.expr,
                  rout.value.expr
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Expected =, got ${result1} and ${result2}.`])
          );
        }
      }
    );
  }
  static synthCong(context, r, location, base, fun) {
    const bout = new PerhapsM("bout");
    const fout = new PerhapsM("f_rst");
    return goOn(
      [
        [bout, () => base.synth(context, r)],
        [fout, () => fun.synth(context, r)]
      ],
      () => {
        const result1 = valInContext(context, bout.value.type);
        const result2 = valInContext(context, fout.value.type);
        if (result1 instanceof Equal) {
          const [Av, fromv, tov] = [result1.type, result1.from, result1.to];
          if (result2 instanceof Pi) {
            const [x, Bv, c] = [result2.argName, result2.argType, result2.resultType];
            const ph = new PerhapsM("ph");
            const Cv = new PerhapsM("Cv");
            const fv = new PerhapsM("fv");
            return goOn(
              [
                [ph, () => sameType(context, location, Av, Bv)],
                [Cv, () => new go(c.valOfClosure(fromv))],
                [fv, () => new go(valInContext(context, fout.value.expr))]
              ],
              () => new go(
                new The(
                  new Equal2(
                    Cv.value.readBackType(context),
                    readBack(context, Cv.value, doApp(fv.value, fromv)),
                    readBack(context, Cv.value, doApp(fv.value, tov))
                  ),
                  new Cong2(
                    bout.value.expr,
                    Cv.value.readBackType(context),
                    fout.value.expr
                  )
                )
              )
            );
          } else {
            return new stop(
              location,
              new Message([`Expected a function type, got ${result2.readBackType(context)}.`])
            );
          }
        } else {
          return new stop(
            location,
            new Message([`Expected an = type, got ${result1.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthSymm(context, r, location, eq) {
    const eout = new PerhapsM("eout");
    return goOn(
      [[eout, () => eq.synth(context, r)]],
      () => {
        const result = valInContext(context, eout.value.type);
        if (result instanceof Equal) {
          const [Av, fromv, tov] = [result.type, result.from, result.to];
          return new go(
            new The(
              new Equal(
                Av,
                tov,
                fromv
              ).readBackType(context),
              new Symm2(
                eout.value.expr
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Expected an = type, got ${result.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthIndEqual(context, r, location, target, motive, base) {
    const tgtout = new PerhapsM("tgtout");
    const motout = new PerhapsM("motout");
    const motv = new PerhapsM("motv");
    const baseout = new PerhapsM("baseout");
    return goOn(
      [[tgtout, () => target.synth(context, r)]],
      () => {
        const result = valInContext(context, tgtout.value.type);
        if (result instanceof Equal) {
          const [Av, fromv, tov] = [result.type, result.from, result.to];
          return goOn(
            [
              [
                motout,
                () => motive.check(
                  context,
                  r,
                  new Pi(
                    "to",
                    Av,
                    new HigherOrderClosure(
                      (to) => new Pi(
                        "p",
                        new Equal(Av, fromv, to),
                        new HigherOrderClosure(
                          (_) => new Universe()
                        )
                      )
                    )
                  )
                )
              ],
              [motv, () => new go(valInContext(context, motout.value))],
              [
                baseout,
                () => base.check(
                  context,
                  r,
                  doApp(doApp(motv.value, fromv), new Same(fromv))
                )
              ]
            ],
            () => new go(
              new The(
                doApp(
                  doApp(motv.value, tov),
                  valInContext(context, tgtout.value.expr)
                ).readBackType(context),
                new IndEqual2(
                  tgtout.value.expr,
                  motout.value,
                  baseout.value
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Expected evidence of equality, got ${result.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthVec(context, r, type, len) {
    const tout = new PerhapsM("tout");
    const lenout = new PerhapsM("lenout");
    return goOn(
      [
        [tout, () => type.check(context, r, new Universe())],
        [lenout, () => len.check(context, r, new Nat())]
      ],
      () => new go(
        new The(
          new Universe2(),
          new Vec2(tout.value, lenout.value)
        )
      )
    );
  }
  static synthHead(context, r, location, vec) {
    const vout = new PerhapsM("vout");
    return goOn(
      [[vout, () => vec.synth(context, r)]],
      () => {
        const result = valInContext(context, vout.value.type).now();
        if (result instanceof Vec) {
          const [T, len] = [result.entryType, result.length];
          const lenNow = len.now();
          if (lenNow instanceof Add1) {
            return new go(
              new The(
                T.readBackType(context),
                new Head2(
                  vout.value.expr
                )
              )
            );
          } else {
            return new stop(
              location,
              new Message([`Expected a Vec with add1 at the top of the length, got ${readBack(context, new Nat(), len)}.`])
            );
          }
        } else {
          return new stop(
            location,
            new Message([`Expected a Vec, got ${result.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthTail(context, r, location, vec) {
    const vout = new PerhapsM("vout");
    return goOn(
      [[vout, () => vec.synth(context, r)]],
      () => {
        const result = valInContext(context, vout.value.type).now();
        if (result instanceof Vec) {
          const [T, len] = [result.entryType, result.length];
          const lenNow = len.now();
          if (lenNow instanceof Add1) {
            const len_minus_1 = lenNow.smaller;
            return new go(
              new The(
                new Vec2(
                  T.readBackType(context),
                  readBack(context, new Nat(), len_minus_1)
                ),
                new Tail2(
                  vout.value.expr
                )
              )
            );
          } else {
            return new stop(
              location,
              new Message([`Expected a Vec with add1 at the top of the length, got ${readBack(context, new Nat(), len)}.`])
            );
          }
        } else {
          return new stop(
            location,
            new Message([`Expected a Vec, got ${result.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthIndVec(context, r, location, length, target, motive, base, step) {
    const lenout = new PerhapsM("lenout");
    const lenv = new PerhapsM("lenv");
    const vecout = new PerhapsM("vecout");
    const motout = new PerhapsM("motout");
    const motval = new PerhapsM("motval");
    const bout = new PerhapsM("bout");
    const sout = new PerhapsM("sout");
    return goOn(
      [
        [lenout, () => length.check(context, r, new Nat())],
        [lenv, () => new go(valInContext(context, lenout.value))],
        [vecout, () => target.synth(context, r)]
      ],
      () => {
        const result = valInContext(context, vecout.value.type);
        if (result instanceof Vec) {
          const [E2, len2v] = [result.entryType, result.length];
          return goOn(
            [
              [new PerhapsM("_"), () => convert(context, location, new Nat(), lenv.value, len2v)],
              [motout, () => motive.check(
                context,
                r,
                new Pi(
                  "k",
                  new Nat(),
                  new HigherOrderClosure(
                    (k) => new Pi(
                      "es",
                      new Vec(E2, k),
                      new HigherOrderClosure(
                        (_) => new Universe()
                      )
                    )
                  )
                )
              )],
              [motval, () => new go(valInContext(context, motout.value))],
              [bout, () => base.check(
                context,
                r,
                doApp(doApp(motval.value, new Zero()), new VecNil())
              )],
              [sout, () => step.check(
                context,
                r,
                indVecStepType(E2, motval.value)
              )]
            ],
            () => new go(
              new The(
                new Application2(
                  new Application2(
                    motout.value,
                    lenout.value
                  ),
                  vecout.value.expr
                ),
                new IndVec(
                  lenout.value,
                  vecout.value.expr,
                  motout.value,
                  bout.value,
                  sout.value
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Expected a Vec, got ${result.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthEither(context, r, left, right) {
    const Lout = new PerhapsM("Lout");
    const Rout = new PerhapsM("Rout");
    return goOn(
      [
        [Lout, () => left.check(context, r, new Universe())],
        [Rout, () => right.check(context, r, new Universe())]
      ],
      () => new go(
        new The(
          new Universe2(),
          new Either2(Lout.value, Rout.value)
        )
      )
    );
  }
  static synthIndEither(context, r, location, target, motive, baseLeft, baseRight) {
    const tgtout = new PerhapsM("tgtout");
    const motout = new PerhapsM("motout");
    const motval = new PerhapsM("motval");
    const lout = new PerhapsM("lout");
    const rout = new PerhapsM("rout");
    return goOn(
      [[tgtout, () => target.synth(context, r)]],
      () => {
        const result = valInContext(context, tgtout.value.type);
        if (result instanceof Either) {
          const [Lv, Rv] = [result.leftType, result.rightType];
          return goOn(
            [
              [
                motout,
                () => motive.check(
                  context,
                  r,
                  new Pi(
                    "x",
                    new Either(Lv, Rv),
                    new HigherOrderClosure(
                      (_) => new Universe()
                    )
                  )
                )
              ],
              [motval, () => new go(valInContext(context, motout.value))],
              [lout, () => baseLeft.check(
                context,
                r,
                new Pi(
                  "x",
                  Lv,
                  new HigherOrderClosure(
                    (x) => doApp(motval.value, new Left(x))
                  )
                )
              )],
              [rout, () => baseRight.check(
                context,
                r,
                new Pi(
                  "x",
                  Rv,
                  new HigherOrderClosure(
                    (x) => doApp(motval.value, new Right(x))
                  )
                )
              )]
            ],
            () => new go(
              new The(
                new Application2(
                  motout.value,
                  tgtout.value.expr
                ),
                new IndEither2(
                  tgtout.value.expr,
                  motout.value,
                  lout.value,
                  rout.value
                )
              )
            )
          );
        } else {
          return new stop(
            location,
            new Message([`Expected an Either, but got a ${result.readBackType(context)}.`])
          );
        }
      }
    );
  }
  static synthThe(context, r, type, value) {
    const tout = new PerhapsM("t_out");
    const eout = new PerhapsM("e_out");
    return goOn(
      [
        [tout, () => type.isType(context, r)],
        [eout, () => value.check(context, r, valInContext(context, tout.value))]
      ],
      () => new go(
        new The(
          tout.value,
          eout.value
        )
      )
    );
  }
  static synthApplication(context, r, location, fun, arg, args) {
    if (fun instanceof Name) {
      const binder = context.get(fun.name);
      if (binder instanceof ConstructorTypeBinder) {
        const constructorApp = new ConstructorApplication(
          location,
          fun.name,
          [arg, ...args]
        );
        return new stop(
          location,
          new Message([`Constructor ${fun.name} requires a type annotation. Use (the Type (${fun.name} ...))`])
        );
      }
    }
    if (args.length === 0) {
      const fout = new PerhapsM("fout");
      return goOn(
        [[fout, () => fun.synth(context, r)]],
        () => {
          const result = valInContext(context, fout.value.type);
          if (result instanceof Pi) {
            const [_, A, c] = [result.argName, result.argType, result.resultType];
            const argout = new PerhapsM("argout");
            return goOn(
              [[argout, () => arg.check(context, r, A)]],
              () => new go(
                new The(
                  c.valOfClosure(valInContext(context, argout.value)).readBackType(context),
                  new Application2(
                    fout.value.expr,
                    argout.value
                  )
                )
              )
            );
          } else {
            return new stop(
              location,
              new Message([`Not a function type: ${result.readBackType(context)}.`])
            );
          }
        }
      );
    } else {
      const appout = new PerhapsM("appout");
      return goOn(
        [[appout, () => new Application3(
          notForInfo(location),
          fun,
          arg,
          args.slice(0, args.length - 1)
        ).synth(context, r)]],
        () => {
          const result = valInContext(context, appout.value.type);
          if (result instanceof Pi) {
            const [x, A, c] = [result.argName, result.argType, result.resultType];
            const argout = new PerhapsM("fout");
            return goOn(
              [[argout, () => args[args.length - 1].check(context, r, A)]],
              () => new go(
                new The(
                  c.valOfClosure(valInContext(context, argout.value)).readBackType(context),
                  new Application2(
                    appout.value.expr,
                    argout.value
                  )
                )
              )
            );
          } else {
            return new stop(
              location,
              new Message([`Not a function type: ${result.readBackType(context)}.`])
            );
          }
        }
      );
    }
  }
  /*
  [x
        (cond [(and (symbol? x) (var-name? x))
               (let ((real-x (rename r x)))
                (go-on ((x-tv (var-type Γ (src-loc e) real-x)))
                  (begin (match (assv real-x Γ)
                           [(cons _ (def _ _))
                            (send-pie-info (src-loc e) 'definition)]
                           [_ (void)])
                         (go `(the ,(read-back-type Γ x-tv) ,real-x)))))]
              [(number? x)
               (cond [(zero? x)
                      (go `(the Nat zero))]
                     [(positive? x)
                      (go-on ((n-1-out (check Γ
                                              r
                                              (@ (src-loc e) (sub1 x))
                                              'NAT)))
                        (go `(the Nat (add1 ,n-1-out))))])]
              [else
               (stop (src-loc e)
                     `("Can't determine a type"))])]
  */
  static synthName(context, r, location, name) {
    const real_x = rename(r, name);
    const x_tv = new PerhapsM("x_tv");
    return goOn(
      [[x_tv, () => varType(context, location, real_x)]],
      () => {
        const result = context.get(real_x);
        if (result instanceof Define) {
          PieInfoHook(location, "definition");
        }
        if (result instanceof InductiveDatatypeBinder) {
          const inductiveType = result.type;
          return new go(
            new The(
              new Universe2(),
              new InductiveTypeConstructor3(
                inductiveType.name,
                inductiveType.parameterTypes.map((p) => p.readBackType(context)),
                inductiveType.indexTypes.map((i) => i.readBackType(context))
              )
            )
          );
        }
        return new go(
          new The(
            x_tv.value.readBackType(context),
            new VarName(real_x)
          )
        );
      }
    );
  }
  static synthNumber(context, r, location, value) {
    if (value === 0) {
      return new go(
        new The(
          new Nat2(),
          new Zero2()
        )
      );
    } else if (value > 0) {
      const n_minus_1_out = new PerhapsM("n_1_out");
      return goOn(
        [[n_minus_1_out, () => new Number2(location, value - 1).check(context, r, new Nat())]],
        () => new go(
          new The(
            new Nat2(),
            new Add12(n_minus_1_out.value)
          )
        )
      );
    } else {
      return new stop(
        location,
        new Message([`Expected a positive number, got ${value}.`])
      );
    }
  }
  /**
   * Synthesize eliminator application for user-defined inductive types
   */
  static synthGeneralEliminator(ctx, r, elimApp) {
    const inductiveTypeResult = getInductiveType(ctx, elimApp.location, elimApp.typeName);
    if (inductiveTypeResult instanceof stop) return inductiveTypeResult;
    const inductiveBinder = inductiveTypeResult.result;
    const inductiveTypeValue = inductiveBinder.type;
    const targetSynth = elimApp.target.synth(ctx, r);
    if (targetSynth instanceof stop) return targetSynth;
    const targetThe = targetSynth.result;
    const targetTypeValue = valInContext(ctx, targetThe.type);
    if (!(targetTypeValue instanceof InductiveTypeConstructor2) || targetTypeValue.name !== elimApp.typeName) {
      return new stop(
        elimApp.location,
        new Message([`Expected type ${elimApp.typeName}, got ${targetTypeValue.readBackType(ctx)}`])
      );
    }
    let indexTypes = inductiveTypeValue.indexTypes;
    const buildMotive = (level, capturedIndices) => {
      if (level >= indexTypes.length) {
        return new Pi(
          "target",
          new InductiveTypeConstructor2(targetTypeValue.name, targetTypeValue.parameters, capturedIndices),
          new HigherOrderClosure((_) => new Universe())
        );
      }
      const indexType = indexTypes[level];
      return new Pi(
        fresh(ctx, "idx"),
        indexType,
        new HigherOrderClosure(
          (indexVal) => buildMotive(level + 1, [...capturedIndices, indexVal])
        )
      );
    };
    const expectedMotiveType = buildMotive(0, []);
    const motiveCheck = elimApp.motive.check(ctx, r, expectedMotiveType);
    if (motiveCheck instanceof stop) return motiveCheck;
    const motiveCore = motiveCheck.result;
    const motiveValue = valInContext(ctx, motiveCore);
    const motiveTypeCore = expectedMotiveType.readBackType(ctx);
    const constructorTypes = this.getConstructorTypesForDatatype(ctx, elimApp.typeName);
    if (elimApp.methods.length !== constructorTypes.length) {
      return new stop(
        elimApp.location,
        new Message([`Expected ${constructorTypes.length} methods, got ${elimApp.methods.length}`])
      );
    }
    let extendedCtx = ctx;
    if (constructorTypes.length > 0) {
      const firstCtor = constructorTypes[0].core;
      for (let i = 0; i < firstCtor.resultType.parameters.length && i < targetTypeValue.parameters.length; i++) {
        const paramCore = firstCtor.resultType.parameters[i];
        if (paramCore instanceof VarName) {
          extendedCtx = bindFree(extendedCtx, paramCore.name, targetTypeValue.parameters[i]);
        }
      }
    }
    const checkedMethods = [];
    const methodTypeCores = [];
    for (let i = 0; i < elimApp.methods.length; i++) {
      const expectedMethodType = this.generateMethodTypeForConstructor(
        extendedCtx,
        constructorTypes[i].core,
        readBack(ctx, expectedMotiveType, motiveValue),
        targetTypeValue.parameters
      );
      methodTypeCores.push(expectedMethodType);
      const methodCheck = elimApp.methods[i].check(ctx, r, valInContext(extendedCtx, expectedMethodType));
      if (methodCheck instanceof stop) return methodCheck;
      checkedMethods.push(methodCheck.result);
    }
    let resultType = motiveValue;
    for (const indexValue of targetTypeValue.indices) {
      resultType = doApp(resultType, indexValue);
    }
    resultType = doApp(resultType, valInContext(ctx, targetThe.expr));
    const eliminatorCore = new Eliminator(
      elimApp.typeName,
      targetThe.expr,
      motiveCore,
      checkedMethods,
      methodTypeCores,
      // Pass method types for proper Neutral handling
      motiveTypeCore
      // Pass motive type for proper Neutral handling with indexed types
    );
    return new go(new The(
      resultType.readBackType(ctx),
      eliminatorCore
    ));
  }
  /**
   * Get constructor types for a datatype from context
   */
  static getConstructorTypesForDatatype(ctx, typeName) {
    const constructorTypes = [];
    for (const [name, binder] of ctx) {
      if (binder instanceof ConstructorTypeBinder) {
        const ctor = binder.constructorType;
        if (ctor.type === typeName) {
          constructorTypes.push({ core: binder.constructorType, resultTypeValue: binder.type });
        }
      }
    }
    return constructorTypes.sort((a, b) => a.core.index - b.core.index);
  }
  /**
   * Generate method type for a constructor
   * Form: (Π [args...] (→ [IHs...] (P ctor)))
   */
  static generateMethodTypeForConstructor(ctx, ctorType, motive_core, typeParams) {
    let cur_ret = motive_core;
    for (const index of ctorType.resultType.indices) {
      cur_ret = new Application2(cur_ret, index);
    }
    const ctor = new Constructor2(
      ctorType.name,
      ctorType.index,
      ctorType.type,
      ctorType.argNames.map((name) => new VarName(name)),
      ctorType.rec_argNames.map((name) => new VarName(name))
    );
    cur_ret = new Application2(cur_ret, ctor);
    for (let i = ctorType.rec_argTypes.length - 1; i >= 0; i--) {
      const recArgTypeCore = ctorType.rec_argTypes[i];
      if (recArgTypeCore instanceof InductiveTypeConstructor3) {
        let ihType = motive_core;
        for (const indexCore of recArgTypeCore.indices) {
          const indexValue = indexCore;
          ihType = new Application2(ihType, indexValue);
        }
        const recArgName = ctorType.rec_argNames[i];
        const recArgVar = new VarName(recArgName);
        ihType = new Application2(ihType, recArgVar);
        const ihName = fresh(ctx, "ih");
        cur_ret = new Pi2(ihName, ihType, cur_ret);
      } else {
        throw new Error("not recursive arg");
      }
    }
    for (let i = ctorType.rec_argTypes.length - 1; i >= 0; i--) {
      const rec_argTypeCore = ctorType.rec_argTypes[i];
      const rec_argName = ctorType.rec_argNames[i];
      cur_ret = new Pi2(rec_argName, rec_argTypeCore, cur_ret);
    }
    for (let i = ctorType.argTypes.length - 1; i >= 0; i--) {
      const argTypeCore = ctorType.argTypes[i];
      const argName = ctorType.argNames[i];
      cur_ret = new Pi2(argName, argTypeCore, cur_ret);
    }
    return cur_ret;
  }
};

// src/pie_interpreter/types/source.ts
var Source = class {
  constructor(location) {
    this.location = location;
  }
  isType(ctx, renames) {
    const ok = new PerhapsM("ok");
    const theType = this.getType(ctx, renames);
    return goOn(
      [[ok, () => theType]],
      () => {
        SendPieInfo(this.location, ["is-type", ok.value]);
        return new go(ok.value);
      }
    );
  }
  getType(ctx, renames) {
    const checkType = this.check(ctx, renames, new Universe());
    if (checkType instanceof go) {
      return checkType;
    } else if (checkType instanceof stop) {
      if (this instanceof Name && isVarName(this.name)) {
        const otherTv = new PerhapsM("other-tv");
        return goOn(
          [
            [
              otherTv,
              () => varType(ctx, this.location, this.name)
            ]
          ],
          () => {
            return new stop(this.location, new Message([`Expected U, but given ${otherTv.value.readBackType(ctx)}`]));
          }
        );
      } else {
        return new stop(this.location, new Message([`not a type`]));
      }
    } else {
      throw new Error("Invalid checkType");
    }
  }
  check(ctx, renames, type) {
    const ok = new PerhapsM("ok");
    const out = this.checkOut(ctx, renames, type);
    return goOn(
      [[ok, () => out]],
      () => new go(ok.value)
    );
  }
  synth(ctx, renames) {
    const ok = new PerhapsM("ok");
    return goOn(
      [[ok, () => this.synthHelper(ctx, renames)]],
      () => {
        SendPieInfo(this.location, ["is-type", ok.value.type]);
        return new go(ok.value);
      }
    );
  }
  checkOut(ctx, renames, type) {
    const theT = new PerhapsM("theT");
    return goOn(
      [
        [theT, () => this.synth(ctx, renames)],
        [
          new PerhapsM("_"),
          () => sameType(ctx, this.location, valInContext(ctx, theT.value.type), type)
        ]
      ],
      () => new go(theT.value.expr)
    );
  }
};
var The2 = class extends Source {
  constructor(location, type, value) {
    super(location);
    this.location = location;
    this.type = type;
    this.value = value;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthThe(ctx, renames, this.type, this.value);
  }
  findNames() {
    return this.type.findNames().concat(this.value.findNames());
  }
  prettyPrint() {
    return `(the ${this.type.prettyPrint()} ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Universe3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthUniverse(ctx, renames, this.location);
  }
  findNames() {
    return [];
  }
  getType(_ctx, _renames) {
    return new go(new Universe2());
  }
  prettyPrint() {
    return "U";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Nat3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthNat(ctx, renames);
  }
  findNames() {
    return [];
  }
  getType(_ctx, _renames) {
    return new go(new Nat2());
  }
  prettyPrint() {
    return "Nat";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Zero3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthZero(ctx, renames);
  }
  findNames() {
    return [];
  }
  prettyPrint() {
    return "zero";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Add13 = class extends Source {
  constructor(location, base) {
    super(location);
    this.location = location;
    this.base = base;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthAdd1(ctx, renames, this.base);
  }
  findNames() {
    return this.base.findNames();
  }
  prettyPrint() {
    return `(add1 ${this.base.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var WhichNat3 = class extends Source {
  constructor(location, target, base, step) {
    super(location);
    this.location = location;
    this.target = target;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthWhichNat(ctx, renames, this.target, this.base, this.step);
  }
  findNames() {
    return this.target.findNames().concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `(which-nat ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IterNat3 = class extends Source {
  constructor(location, target, base, step) {
    super(location);
    this.location = location;
    this.target = target;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIterNat(ctx, renames, this.target, this.base, this.step);
  }
  findNames() {
    return this.target.findNames().concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `(iter-nat ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var RecNat3 = class extends Source {
  constructor(location, target, base, step) {
    super(location);
    this.location = location;
    this.target = target;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthRecNat(ctx, renames, this.target, this.base, this.step);
  }
  findNames() {
    return this.target.findNames().concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `(rec-nat ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndNat3 = class extends Source {
  constructor(location, target, motive, base, step) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIndNat(ctx, renames, this.target, this.motive, this.base, this.step);
  }
  findNames() {
    return this.target.findNames().concat(this.motive.findNames()).concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `(ind-nat ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Arrow = class _Arrow extends Source {
  constructor(location, arg1, arg2, args) {
    super(location);
    this.location = location;
    this.arg1 = arg1;
    this.arg2 = arg2;
    this.args = args;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthArrow(ctx, renames, this.location, this.arg1, this.arg2, this.args);
  }
  findNames() {
    return this.arg1.findNames().concat(this.arg2.findNames()).concat(this.args.flatMap((arg) => arg.findNames()));
  }
  getType(ctx, renames) {
    const [A, B, args] = [this.arg1, this.arg2, this.args];
    if (args.length === 0) {
      const x = freshBinder(ctx, B, "x");
      const Aout = new PerhapsM("Aout");
      const Bout = new PerhapsM("Bout");
      return goOn(
        [
          [Aout, () => A.isType(ctx, renames)],
          [
            Bout,
            () => B.isType(
              bindFree(ctx, x, valInContext(ctx, Aout.value)),
              renames
            )
          ]
        ],
        () => {
          return new go(
            new Pi2(x, Aout.value, Bout.value)
          );
        }
      );
    } else {
      const [rest0, ...rest] = args;
      const x = freshBinder(ctx, makeApp(B, rest0, rest), "x");
      const Aout = new PerhapsM("Aout");
      const tout = new PerhapsM("tout");
      return goOn(
        [
          [Aout, () => A.isType(ctx, renames)],
          [
            tout,
            () => new _Arrow(
              notForInfo(this.location),
              B,
              rest0,
              rest
            ).isType(
              bindFree(ctx, x, valInContext(ctx, Aout.value)),
              renames
            )
          ]
        ],
        () => new go(new Pi2(x, Aout.value, tout.value))
      );
    }
  }
  prettyPrint() {
    return `(-> ${this.arg1.prettyPrint()} ${this.arg2.prettyPrint()} ${this.args.map((arg) => arg.prettyPrint()).join(" ")})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Pi3 = class _Pi extends Source {
  constructor(location, binders, body) {
    super(location);
    this.location = location;
    this.binders = binders;
    this.body = body;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthPi(ctx, renames, this.location, this.binders, this.body);
  }
  findNames() {
    return this.binders.flatMap((binder) => occurringBinderNames(binder)).concat(this.body.findNames());
  }
  getType(ctx, renames) {
    const [binders, B] = [this.binders, this.body];
    if (binders.length === 1) {
      const [bd, A] = [binders[0].binder, binders[0].type];
      const y = fresh(ctx, bd.varName);
      const xloc = bd.location;
      const Aout = new PerhapsM("Aout");
      const Aoutv = new PerhapsM("Aoutv");
      const Bout = new PerhapsM("Bout");
      return goOn(
        [
          [Aout, () => A.isType(ctx, renames)],
          [
            Aoutv,
            () => new go(valInContext(ctx, Aout.value))
          ],
          [
            Bout,
            () => B.isType(
              bindFree(ctx, y, Aoutv.value),
              extendRenaming(renames, bd.varName, y)
            )
          ]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new Pi2(
              y,
              Aout.value,
              Bout.value
            )
          );
        }
      );
    } else if (binders.length > 1) {
      const [bd, ...rest] = binders;
      const [x, A] = [bd.binder.varName, bd.type];
      const z = fresh(ctx, x);
      const xloc = bd.binder.location;
      const Aout = new PerhapsM("Aout");
      const Aoutv = new PerhapsM("Aoutv");
      const Bout = new PerhapsM("Bout");
      return goOn(
        [
          [Aout, () => A.isType(ctx, renames)],
          [
            Aoutv,
            () => new go(valInContext(ctx, Aout.value))
          ],
          [
            Bout,
            () => new _Pi(
              notForInfo(this.location),
              rest,
              B
            ).isType(
              bindFree(ctx, z, Aoutv.value),
              extendRenaming(renames, bd.binder.varName, z)
            )
          ]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new Pi2(
              z,
              Aout.value,
              Bout.value
            )
          );
        }
      );
    } else {
      throw new Error("Invalid number of binders in Pi type");
    }
  }
  prettyPrint() {
    return `(\u03A0 ${this.binders.map((binder) => `(${binder.binder.varName} ${binder.type.prettyPrint()})`).join(" ")} 
            ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Lambda3 = class extends Source {
  constructor(location, binders, body) {
    super(location);
    this.location = location;
    this.binders = binders;
    this.body = body;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return this.binders.map((binder) => binder.varName).concat(this.body.findNames());
  }
  checkOut(ctx, renames, type) {
    if (this.binders.length === 1) {
      const body = this.body;
      const binder = this.binders[0];
      const x = binder.varName;
      const xLoc = binder.location;
      const typeNow = type.now();
      if (typeNow instanceof Pi) {
        const A = typeNow.argType;
        const closure = typeNow.resultType;
        const xRenamed = rename(renames, x);
        const bout = new PerhapsM("bout");
        return goOn(
          [
            [
              bout,
              () => body.check(
                bindFree(ctx, xRenamed, A),
                extendRenaming(renames, x, xRenamed),
                closure.valOfClosure(
                  new Neutral(
                    A,
                    new Variable(xRenamed)
                  )
                )
              )
            ]
          ],
          () => {
            PieInfoHook(xLoc, ["binding-site", A.readBackType(ctx)]);
            return new go(new Lambda2(xRenamed, bout.value));
          }
        );
      } else {
        return new stop(
          xLoc,
          new Message([`Not a function type: ${typeNow.readBackType(ctx)}.`])
        );
      }
    } else {
      return new Lambda3(
        this.location,
        [this.binders[0]],
        new Lambda3(
          notForInfo(this.location),
          this.binders.slice(1),
          this.body
        )
      ).check(ctx, renames, type);
    }
  }
  prettyPrint() {
    return `(lambda ${this.binders.map((binder) => binder.varName).join(" ")} ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Sigma3 = class _Sigma extends Source {
  constructor(location, binders, body) {
    super(location);
    this.location = location;
    this.binders = binders;
    this.body = body;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthSigma(ctx, renames, this.location, this.binders, this.body);
  }
  findNames() {
    return this.binders.flatMap((binder) => occurringBinderNames(binder)).concat(this.body.findNames());
  }
  getType(ctx, renames) {
    const [binders, D] = [this.binders, this.body];
    if (binders.length === 1) {
      const [bd, A] = [binders[0].binder, binders[0].type];
      const x = bd.varName;
      const y = fresh(ctx, x);
      const xloc = bd.location;
      const Aout = new PerhapsM("Aout");
      const Aoutv = new PerhapsM("Aoutv");
      const Dout = new PerhapsM("Dout");
      return goOn(
        [
          [Aout, () => A.isType(ctx, renames)],
          [Aoutv, () => new go(valInContext(ctx, Aout.value))],
          [
            Dout,
            () => D.isType(
              bindFree(ctx, y, Aoutv.value),
              extendRenaming(renames, x, y)
            )
          ]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new Sigma2(y, Aout.value, Dout.value)
          );
        }
      );
    } else if (binders.length > 1) {
      const [[bd, A], ...rest] = [[binders[0].binder, binders[0].type], binders[1], ...binders.slice(2)];
      const x = bd.varName;
      const z = fresh(ctx, x);
      const xloc = bd.location;
      const Aout = new PerhapsM("Aout");
      const Aoutv = new PerhapsM("Aoutv");
      const Dout = new PerhapsM("Dout");
      return goOn(
        [
          [Aout, () => A.isType(ctx, renames)],
          [Aoutv, () => new go(valInContext(ctx, Aout.value))],
          [
            Dout,
            () => new _Sigma(this.location, rest, D).isType(
              bindFree(ctx, x, Aoutv.value),
              extendRenaming(renames, x, z)
            )
          ]
        ],
        () => {
          PieInfoHook(xloc, ["binding-site", Aout.value]);
          return new go(
            new Sigma2(z, Aout.value, Dout.value)
          );
        }
      );
    } else {
      throw new Error("Invalid number of binders in Sigma type");
    }
  }
  prettyPrint() {
    return `(\u03A3 ${this.binders.map((binder) => `(${binder.binder.varName} ${binder.type.prettyPrint()})`).join(" ")} 
            ${this.body.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Name = class extends Source {
  constructor(location, name) {
    super(location);
    this.location = location;
    this.name = name;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthName(ctx, renames, this.location, this.name);
  }
  findNames() {
    return [this.name];
  }
  prettyPrint() {
    return this.name;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Atom3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthAtom(ctx, renames);
  }
  findNames() {
    return [];
  }
  getType(_ctx, _renames) {
    return new go(new Atom2());
  }
  prettyPrint() {
    return "Atom";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Quote3 = class extends Source {
  constructor(location, name) {
    super(location);
    this.location = location;
    this.name = name;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthQuote(ctx, renames, this.location, this.name);
  }
  findNames() {
    return [];
  }
  prettyPrint() {
    return `'${this.name}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Pair = class extends Source {
  constructor(location, first, second) {
    super(location);
    this.location = location;
    this.first = first;
    this.second = second;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthPair(ctx, renames, this.first, this.second);
  }
  findNames() {
    return this.first.findNames().concat(this.second.findNames());
  }
  getType(ctx, renames) {
    const Aout = new PerhapsM("Aout");
    const Dout = new PerhapsM("Dout");
    const x = freshBinder(ctx, this.second, "x");
    return goOn(
      [
        [Aout, () => this.first.isType(ctx, renames)],
        [Dout, () => this.second.isType(
          bindFree(ctx, x, valInContext(ctx, Aout.value)),
          renames
        )]
      ],
      () => new go(new Sigma2(x, Aout.value, Dout.value))
    );
  }
  prettyPrint() {
    return `(Pair ${this.first.prettyPrint()} ${this.second.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cons3 = class extends Source {
  constructor(location, first, second) {
    super(location);
    this.location = location;
    this.first = first;
    this.second = second;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return this.first.findNames().concat(this.second.findNames());
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof Sigma) {
      const A = typeNow.carType;
      const closure = typeNow.cdrType;
      const aout = new PerhapsM("aout");
      const dout = new PerhapsM("dout");
      return goOn(
        [
          [aout, () => this.first.check(ctx, renames, A)],
          [
            dout,
            () => this.second.check(
              ctx,
              renames,
              closure.valOfClosure(valInContext(ctx, aout.value))
            )
          ]
        ],
        () => new go(
          new Cons2(aout.value, dout.value)
        )
      );
    } else {
      return new stop(
        this.location,
        new Message([`cons requires a Pair or \u03A3 type, but was used as a: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return `(cons ${this.first.prettyPrint()} ${this.second.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Car3 = class extends Source {
  constructor(location, pair) {
    super(location);
    this.location = location;
    this.pair = pair;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthCar(ctx, renames, this.location, this.pair);
  }
  findNames() {
    return this.pair.findNames();
  }
  prettyPrint() {
    return `(car ${this.pair.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cdr3 = class extends Source {
  constructor(location, pair) {
    super(location);
    this.location = location;
    this.pair = pair;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthCdr(ctx, renames, this.location, this.pair);
  }
  findNames() {
    return this.pair.findNames();
  }
  prettyPrint() {
    return `(cdr ${this.pair.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Trivial3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthTrivial(ctx, renames);
  }
  findNames() {
    return [];
  }
  getType(_ctx, _renames) {
    return new go(new Trivial2());
  }
  prettyPrint() {
    return "Trivial";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Sole3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthSole(ctx, renames);
  }
  findNames() {
    return [];
  }
  prettyPrint() {
    return "Sole";
  }
};
var Nil3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return [];
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof List) {
      return new go(new Nil2());
    } else {
      return new stop(
        this.location,
        new Message([`nil requires a List type, but was used as a: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return "nil";
  }
  toString() {
    return this.prettyPrint();
  }
};
var Number2 = class extends Source {
  constructor(location, value) {
    super(location);
    this.location = location;
    this.value = value;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthNumber(ctx, renames, this.location, this.value);
  }
  findNames() {
    return [];
  }
  prettyPrint() {
    return `${this.value}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var List3 = class extends Source {
  constructor(location, entryType) {
    super(location);
    this.location = location;
    this.entryType = entryType;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthList(ctx, renames, this);
  }
  findNames() {
    return this.entryType.findNames();
  }
  getType(ctx, renames) {
    const Eout = new PerhapsM("Eout");
    return goOn(
      [[Eout, () => this.entryType.isType(ctx, renames)]],
      () => new go(new List2(Eout.value))
    );
  }
  prettyPrint() {
    return `(List ${this.entryType.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var ListCons3 = class extends Source {
  constructor(location, x, xs) {
    super(location);
    this.location = location;
    this.x = x;
    this.xs = xs;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthListCons(ctx, renames, this.x, this.xs);
  }
  findNames() {
    return this.x.findNames().concat(this.xs.findNames());
  }
  prettyPrint() {
    return `(:: ${this.x.prettyPrint()} ${this.xs.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var RecList3 = class extends Source {
  constructor(location, target, base, step) {
    super(location);
    this.location = location;
    this.target = target;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthRecList(ctx, renames, this.location, this.target, this.base, this.step);
  }
  findNames() {
    return this.target.findNames().concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `(rec-list ${this.target.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndList3 = class extends Source {
  constructor(location, target, motive, base, step) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIndList(ctx, renames, this.location, this.target, this.motive, this.base, this.step);
  }
  findNames() {
    return this.target.findNames().concat(this.motive.findNames()).concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `(ind-list ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()} 
              ${this.step.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Absurd3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthAbsurd(ctx, renames, this);
  }
  findNames() {
    return [];
  }
  getType(_ctx, _renames) {
    return new go(new Absurd2());
  }
  prettyPrint() {
    return "Absurd";
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndAbsurd3 = class extends Source {
  constructor(location, target, motive) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIndAbsurd(ctx, renames, this);
  }
  findNames() {
    return this.target.findNames().concat(this.motive.findNames());
  }
  prettyPrint() {
    return `(ind-Absurd 
              ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Equal3 = class extends Source {
  constructor(location, type, left, right) {
    super(location);
    this.location = location;
    this.type = type;
    this.left = left;
    this.right = right;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthEqual(ctx, renames, this.type, this.left, this.right);
  }
  findNames() {
    return this.type.findNames().concat(this.left.findNames()).concat(this.right.findNames());
  }
  getType(ctx, renames) {
    const [A, from, to] = [this.type, this.left, this.right];
    const Aout = new PerhapsM("Aout");
    const Av = new PerhapsM("Av");
    const from_out = new PerhapsM("from_out");
    const to_out = new PerhapsM("to_out");
    return goOn(
      [
        [Aout, () => A.isType(ctx, renames)],
        [Av, () => new go(valInContext(ctx, Aout.value))],
        [from_out, () => from.check(ctx, renames, Av.value)],
        [to_out, () => to.check(ctx, renames, Av.value)]
      ],
      () => new go(
        new Equal2(Aout.value, from_out.value, to_out.value)
      )
    );
  }
  prettyPrint() {
    return `(= ${this.type.prettyPrint()} 
              ${this.left.prettyPrint()} 
              ${this.right.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Same3 = class extends Source {
  constructor(location, type) {
    super(location);
    this.location = location;
    this.type = type;
  }
  findNames() {
    return this.type.findNames();
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof Equal) {
      const A = typeNow.type;
      const from = typeNow.from;
      const to = typeNow.to;
      const cout = new PerhapsM("cout");
      const val = new PerhapsM("val");
      return goOn(
        [
          [cout, () => this.type.check(ctx, renames, A)],
          [val, () => new go(valInContext(ctx, cout.value))],
          [
            new PerhapsM("_"),
            () => convert(ctx, this.type.location, A, from, val.value)
          ],
          [
            new PerhapsM("_"),
            () => convert(ctx, this.type.location, A, to, val.value)
          ]
        ],
        () => new go(new Same2(cout.value))
      );
    } else {
      return new stop(
        this.location,
        new Message([`same requires an Equal type, but encounter: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return `(same ${this.type.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Replace3 = class extends Source {
  constructor(location, target, motive, base) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
    this.base = base;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthReplace(ctx, renames, this.location, this.target, this.motive, this.base);
  }
  findNames() {
    return this.target.findNames().concat(this.motive.findNames()).concat(this.base.findNames());
  }
  prettyPrint() {
    return `(replace ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Trans3 = class extends Source {
  constructor(location, left, right) {
    super(location);
    this.location = location;
    this.left = left;
    this.right = right;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthTrans(ctx, renames, this.location, this.left, this.right);
  }
  findNames() {
    return this.left.findNames().concat(this.right.findNames());
  }
  prettyPrint() {
    return `(trans ${this.left.prettyPrint()} ${this.right.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Cong3 = class extends Source {
  constructor(location, target, fun) {
    super(location);
    this.location = location;
    this.target = target;
    this.fun = fun;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthCong(ctx, renames, this.location, this.target, this.fun);
  }
  findNames() {
    return this.target.findNames().concat(this.fun.findNames());
  }
  prettyPrint() {
    return `(cong ${this.target.prettyPrint()} ${this.fun.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Symm3 = class extends Source {
  constructor(location, equality) {
    super(location);
    this.location = location;
    this.equality = equality;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthSymm(ctx, renames, this.location, this.equality);
  }
  findNames() {
    return this.equality.findNames();
  }
  prettyPrint() {
    return `(symm ${this.equality.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndEqual3 = class extends Source {
  constructor(location, target, motive, base) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
    this.base = base;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIndEqual(ctx, renames, this.location, this.target, this.motive, this.base);
  }
  findNames() {
    return this.target.findNames().concat(this.motive.findNames()).concat(this.base.findNames());
  }
  prettyPrint() {
    return `(ind-= ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.base.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Vec3 = class extends Source {
  constructor(location, type, length) {
    super(location);
    this.location = location;
    this.type = type;
    this.length = length;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthVec(ctx, renames, this.type, this.length);
  }
  findNames() {
    return this.type.findNames().concat(this.length.findNames());
  }
  getType(ctx, renames) {
    const Eout = new PerhapsM("Eout");
    const lenout = new PerhapsM("lenout");
    return goOn(
      [
        [Eout, () => this.type.isType(ctx, renames)],
        [lenout, () => this.length.check(ctx, renames, new Nat())]
      ],
      () => new go(new Vec2(Eout.value, lenout.value))
    );
  }
  prettyPrint() {
    return `(Vec ${this.type.prettyPrint()} ${this.length.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var VecNil3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return [];
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof Vec) {
      const lenNow = typeNow.length.now();
      if (lenNow instanceof Zero) {
        return new go(new VecNil2());
      } else {
        return new stop(
          this.location,
          new Message([`vecnil requires a Vec type with length ZERO, but was used as a: 
          ${readBack(ctx, new Nat(), typeNow.length)}.`])
        );
      }
    } else {
      return new stop(
        this.location,
        new Message([`vecnil requires a Vec type, but was used as a: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return "vecnil";
  }
  toString() {
    return this.prettyPrint();
  }
};
var VecCons3 = class extends Source {
  constructor(location, x, xs) {
    super(location);
    this.location = location;
    this.x = x;
    this.xs = xs;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return this.x.findNames().concat(this.xs.findNames());
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof Vec) {
      const lenNow = typeNow.length.now();
      if (lenNow instanceof Add1) {
        const hout = new PerhapsM("hout");
        const tout = new PerhapsM("tout");
        const n_minus_1 = lenNow.smaller;
        return goOn(
          [
            [hout, () => this.x.check(ctx, renames, typeNow.entryType)],
            [
              tout,
              () => this.xs.check(ctx, renames, new Vec(typeNow.entryType, n_minus_1))
            ]
          ],
          () => new go(new VecCons2(hout.value, tout.value))
        );
      } else {
        return new stop(
          this.location,
          new Message([`vec:: requires a Vec type with length Add1, but was used with a: 
          ${readBack(ctx, new Nat(), typeNow.length)}.`])
        );
      }
    } else {
      return new stop(
        this.location,
        new Message([`vec:: requires a Vec type, but was used as a: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return `(vec:: ${this.x.prettyPrint()} ${this.xs.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Head3 = class extends Source {
  constructor(location, vec) {
    super(location);
    this.location = location;
    this.vec = vec;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthHead(ctx, renames, this.location, this.vec);
  }
  findNames() {
    return this.vec.findNames();
  }
  prettyPrint() {
    return `(head ${this.vec.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Tail3 = class extends Source {
  constructor(location, vec) {
    super(location);
    this.location = location;
    this.vec = vec;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthTail(ctx, renames, this.location, this.vec);
  }
  findNames() {
    return this.vec.findNames();
  }
  prettyPrint() {
    return `(tail ${this.vec.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndVec3 = class extends Source {
  constructor(location, length, target, motive, base, step) {
    super(location);
    this.location = location;
    this.length = length;
    this.target = target;
    this.motive = motive;
    this.base = base;
    this.step = step;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIndVec(
      ctx,
      renames,
      this.location,
      this.length,
      this.target,
      this.motive,
      this.base,
      this.step
    );
  }
  findNames() {
    return this.length.findNames().concat(this.target.findNames()).concat(this.motive.findNames()).concat(this.base.findNames()).concat(this.step.findNames());
  }
  prettyPrint() {
    return `ind-Vec ${this.length.prettyPrint()}
              ${this.target.prettyPrint()}
              ${this.motive.prettyPrint()}
              ${this.base.prettyPrint()}
              ${this.step.prettyPrint()}`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Either3 = class extends Source {
  constructor(location, left, right) {
    super(location);
    this.location = location;
    this.left = left;
    this.right = right;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthEither(ctx, renames, this.left, this.right);
  }
  findNames() {
    return this.left.findNames().concat(this.right.findNames());
  }
  getType(ctx, renames) {
    const Lout = new PerhapsM("Lout");
    const Rout = new PerhapsM("Rout");
    return goOn(
      [
        [Lout, () => this.left.isType(ctx, renames)],
        [Rout, () => this.right.isType(ctx, renames)]
      ],
      () => new go(new Either2(Lout.value, Rout.value))
    );
  }
  prettyPrint() {
    return `(Either ${this.left.prettyPrint()} ${this.right.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Left3 = class extends Source {
  constructor(location, value) {
    super(location);
    this.location = location;
    this.value = value;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return this.value.findNames();
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof Either) {
      const lout = new PerhapsM("lout");
      return goOn(
        [
          [lout, () => this.value.check(ctx, renames, typeNow.leftType)]
        ],
        () => new go(new Left2(lout.value))
      );
    } else {
      return new stop(
        this.location,
        new Message([`left requires an Either type, but was used as a: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return `(left ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Right3 = class extends Source {
  constructor(location, value) {
    super(location);
    this.location = location;
    this.value = value;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return this.value.findNames();
  }
  checkOut(ctx, renames, type) {
    const typeNow = type.now();
    if (typeNow instanceof Either) {
      const rout = new PerhapsM("rout");
      return goOn(
        [
          [rout, () => this.value.check(ctx, renames, typeNow.rightType)]
        ],
        () => new go(new Right2(rout.value))
      );
    } else {
      return new stop(
        this.location,
        new Message([`right requires an Either type, but was used as a: ${typeNow.readBackType(ctx)}.`])
      );
    }
  }
  prettyPrint() {
    return `(right ${this.value.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var IndEither3 = class extends Source {
  constructor(location, target, motive, baseLeft, baseRight) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
    this.baseLeft = baseLeft;
    this.baseRight = baseRight;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthIndEither(ctx, renames, this.location, this.target, this.motive, this.baseLeft, this.baseRight);
  }
  findNames() {
    return this.target.findNames().concat(this.motive.findNames()).concat(this.baseLeft.findNames()).concat(this.baseRight.findNames());
  }
  prettyPrint() {
    return `(ind-Either ${this.target.prettyPrint()} 
              ${this.motive.prettyPrint()} 
              ${this.baseLeft.prettyPrint()} 
              ${this.baseRight.prettyPrint()})`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var TODO3 = class extends Source {
  constructor(location) {
    super(location);
    this.location = location;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  findNames() {
    return [];
  }
  checkOut(ctx, renames, type) {
    const typeVal = type.readBackType(ctx);
    SendPieInfo(this.location, ["TODO", readBackContext(ctx), typeVal, renames]);
    return new go(new TODO(this.location.locationToSrcLoc(), typeVal));
  }
  prettyPrint() {
    return `TODO`;
  }
  toString() {
    return this.prettyPrint();
  }
};
var Application3 = class extends Source {
  constructor(location, func, arg, args) {
    super(location);
    this.location = location;
    this.func = func;
    this.arg = arg;
    this.args = args;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthApplication(ctx, renames, this.location, this.func, this.arg, this.args);
  }
  findNames() {
    return this.func.findNames().concat(this.arg.findNames()).concat(this.args.flatMap((arg) => arg.findNames()));
  }
  prettyPrint() {
    return `(${this.func.prettyPrint()} ${this.arg.prettyPrint()} ${this.args.map((arg) => arg.prettyPrint()).join(" ")})`;
  }
  toString() {
    return this.prettyPrint();
  }
  // Override getType to handle inductive type applications
  getType(ctx, renames) {
    if (this.func instanceof Name) {
      const funcName = this.func.name;
      const binder = ctx.get(funcName);
      if (binder instanceof InductiveDatatypeBinder) {
        const allArgs = [this.arg, ...this.args];
        const generalTypeCtor = new GeneralTypeConstructor(
          this.location,
          funcName,
          [],
          // parameters - will be inferred from context
          allArgs
        );
        return generalTypeCtor.getType(ctx, renames);
      }
    }
    return super.getType(ctx, renames);
  }
  // Override checkOut to handle constructor applications
  checkOut(ctx, renames, type) {
    if (this.func instanceof Name) {
      const funcName = this.func.name;
      const binder = ctx.get(funcName);
      if (binder instanceof ConstructorTypeBinder) {
        const constructorApp = new ConstructorApplication(
          this.location,
          funcName,
          [this.arg, ...this.args]
        );
        return constructorApp.checkOut(ctx, renames, type);
      }
    }
    return super.checkOut(ctx, renames, type);
  }
};
var GeneralType = class extends Source {
  constructor(location, name, paramType, indicesType) {
    super(location);
    this.location = location;
    this.name = name;
    this.paramType = paramType;
    this.indicesType = indicesType;
  }
  findNames() {
    throw new Error("Method not implemented.");
  }
  prettyPrint() {
    throw new Error("Method not implemented.");
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  getType(ctx, rename2) {
    let cur_ctx = ctx;
    let cur_rename = rename2;
    const normalizedParamType = [];
    const normalizedIndicesType = [];
    for (let i = 0; i < this.paramType.length; i++) {
      const fresh_name = fresh(cur_ctx, this.paramType[i].binder.varName);
      const resultTemp = this.paramType[i].type.isType(cur_ctx, cur_rename);
      cur_rename = extendRenaming(cur_rename, this.paramType[i].binder.varName, fresh_name);
      if (resultTemp instanceof stop) {
        return resultTemp;
      }
      cur_ctx = bindFree(
        cur_ctx,
        fresh_name,
        valInContext(cur_ctx, resultTemp.result)
      );
      normalizedParamType.push(resultTemp.result);
    }
    for (let i = 0; i < this.indicesType.length; i++) {
      const fresh_name = fresh(cur_ctx, this.indicesType[i].binder.varName);
      const resultTemp = this.indicesType[i].type.isType(cur_ctx, cur_rename);
      cur_rename = extendRenaming(cur_rename, this.indicesType[i].binder.varName, fresh_name);
      if (resultTemp instanceof stop) {
        return resultTemp;
      }
      cur_ctx = bindFree(
        cur_ctx,
        fresh_name,
        valInContext(cur_ctx, resultTemp.result)
      );
      normalizedIndicesType.push(resultTemp.result);
    }
    return new go(new InductiveType2(this.name, normalizedParamType, normalizedIndicesType));
  }
};
var GeneralTypeConstructor = class extends Source {
  constructor(location, name, params, indices) {
    super(location);
    this.location = location;
    this.name = name;
    this.params = params;
    this.indices = indices;
  }
  findNames() {
    throw new Error("Method not implemented.");
  }
  prettyPrint() {
    throw new Error("Method not implemented.");
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  getType(ctx, renames) {
    const inductiveResult = getInductiveType(ctx, this.location, this.name);
    if (inductiveResult instanceof stop) return inductiveResult;
    const inductiveBinder = inductiveResult.result;
    const inductiveType = inductiveBinder.type;
    if (this.params.length !== inductiveType.parameterTypes.length || this.indices.length !== inductiveType.indexTypes.length) {
      return new stop(
        this.location,
        new Message(["Parameter/index count mismatch for type " + this.name])
      );
    }
    const normalizedParams = [];
    for (let i = 0; i < this.params.length; i++) {
      const paramCheck = this.params[i].check(ctx, renames, inductiveType.parameterTypes[i].now());
      if (paramCheck instanceof stop) return paramCheck;
      normalizedParams.push(paramCheck.result);
    }
    const normalizedIndices = [];
    for (let i = 0; i < this.indices.length; i++) {
      const indexCheck = this.indices[i].check(ctx, renames, inductiveType.indexTypes[i].now());
      if (indexCheck instanceof stop) return indexCheck;
      normalizedIndices.push(indexCheck.result);
    }
    return new go(new InductiveTypeConstructor3(this.name, normalizedParams, normalizedIndices));
  }
  checkOut(ctx, renames, target) {
    const cur_val = target.now();
    if (cur_val instanceof Universe) {
      return this.getType(ctx, renames);
    }
    const normalized_params = [];
    const normalized_indices = [];
    if (!(cur_val instanceof InductiveType3)) {
      return new stop(this.location, new Message(["target type is not user defined inductive type, or use the wrong type"]));
    }
    const targetType = cur_val;
    const paramTypes = targetType.parameterTypes;
    const idxTypes = targetType.indexTypes;
    if (this.params.length != paramTypes.length || this.indices.length != idxTypes.length) {
      return new stop(this.location, new Message(["the number of parameters/indices is inconsistent in constructor"]));
    }
    for (let i = 0; i < this.params.length; i++) {
      const result = this.params[i].check(ctx, renames, paramTypes[i].now());
      if (result instanceof stop) {
        return stop;
      }
      normalized_params.push(result.result);
    }
    for (let i = 0; i < this.indices.length; i++) {
      const result = this.indices[i].check(ctx, renames, idxTypes[i].now());
      if (result instanceof stop) {
        return stop;
      }
      normalized_indices.push(result.result);
    }
    return new go(new InductiveTypeConstructor3(this.name, normalized_params, normalized_indices));
  }
};
var EliminatorApplication = class extends Source {
  constructor(location, typeName, target, motive, methods) {
    super(location);
    this.location = location;
    this.typeName = typeName;
    this.target = target;
    this.motive = motive;
    this.methods = methods;
  }
  findNames() {
    return [this.typeName].concat(this.target.findNames()).concat(this.motive.findNames()).concat(this.methods.flatMap((m) => m.findNames()));
  }
  prettyPrint() {
    const methods = this.methods.map((m) => m.prettyPrint()).join(" ");
    return `(ind-${this.typeName} ${this.target.prettyPrint()} ${this.motive.prettyPrint()} ${methods})`;
  }
  synthHelper(ctx, renames) {
    return synthesizer.synthGeneralEliminator(ctx, renames, this);
  }
};
var ConstructorApplication = class extends Source {
  constructor(location, constructorName, args) {
    super(location);
    this.location = location;
    this.constructorName = constructorName;
    this.args = args;
  }
  findNames() {
    return [this.constructorName].concat(this.args.flatMap((a) => a.findNames()));
  }
  prettyPrint() {
    const args = this.args.map((a) => a.prettyPrint()).join(" ");
    return `(${this.constructorName}${args.length > 0 ? " " + args : ""})`;
  }
  synthHelper(_ctx, _renames) {
    throw new Error("Method not implemented.");
  }
  checkOut(ctx, renames, type) {
    const constructorBinder = ctx.get(this.constructorName);
    if (!constructorBinder || !(constructorBinder instanceof ConstructorTypeBinder)) {
      return new stop(this.location, new Message([`Unknown constructor: ${this.constructorName}`]));
    }
    const ctorType = constructorBinder.constructorType;
    const expectedTypeNow = type.now();
    if (!(expectedTypeNow instanceof InductiveTypeConstructor2)) {
      return new stop(this.location, new Message(["Expected inductive type constructor"]));
    }
    const inductiveBinder = ctx.get(ctorType.type);
    if (!inductiveBinder || !(inductiveBinder instanceof InductiveDatatypeBinder)) {
      return new stop(this.location, new Message([`Unknown inductive type: ${ctorType.type}`]));
    }
    const resultTypeCore = ctorType.resultType;
    let currentCtx = ctx;
    for (let i = 0; i < resultTypeCore.parameters.length; i++) {
      const paramCore = resultTypeCore.parameters[i];
      if (paramCore instanceof VarName) {
        const paramName = paramCore.name;
        const concreteValue = expectedTypeNow.parameters[i].now();
        currentCtx = bindVal(currentCtx, paramName, new Universe(), concreteValue);
      }
    }
    for (let i = 0; i < resultTypeCore.indices.length; i++) {
      const indexCore = resultTypeCore.indices[i];
      if (indexCore instanceof VarName) {
        const indexName = indexCore.name;
        const concreteValue = expectedTypeNow.indices[i].now();
        const indexType = inductiveBinder.type.indexTypes[i].now();
        currentCtx = bindVal(currentCtx, indexName, indexType, concreteValue);
      }
    }
    const returnTypeValue = constructorBinder.type;
    const indexArgNames = [];
    returnTypeValue.indices.forEach((i) => {
      indexArgNames.push(...extractVarNamesFromValue(i));
    });
    const normalized_args = [];
    const normalized_rec_args = [];
    const allArgTypes = [...ctorType.argTypes, ...ctorType.rec_argTypes];
    if (this.args.length !== allArgTypes.length) {
      return new stop(this.location, new Message([
        `Constructor ${this.constructorName} expects ${allArgTypes.length} arguments, but got ${this.args.length}`
      ]));
    }
    for (let i = 0; i < ctorType.argTypes.length; i++) {
      const argTypeCore = ctorType.argTypes[i];
      const argTypeValue = valInContext(currentCtx, argTypeCore);
      const result = this.args[i].check(currentCtx, renames, argTypeValue);
      if (result instanceof stop) {
        return result;
      }
      const checkedArgCore = result.result;
      normalized_args.push(checkedArgCore);
      if (i < indexArgNames.length) {
        const argName = indexArgNames[i];
        const checkedArgValue = valInContext(currentCtx, checkedArgCore);
        const argType = argTypeValue;
        currentCtx = bindVal(currentCtx, argName, argType, checkedArgValue);
      }
    }
    const recArgStartIdx = ctorType.argTypes.length;
    for (let i = 0; i < ctorType.rec_argTypes.length; i++) {
      const recArgTypeCore = ctorType.rec_argTypes[i];
      const recArgTypeValue = valInContext(currentCtx, recArgTypeCore);
      const result = this.args[i + recArgStartIdx].check(currentCtx, renames, recArgTypeValue);
      if (result instanceof stop) {
        return result;
      }
      const checkedRecArgCore = result.result;
      normalized_rec_args.push(checkedRecArgCore);
      const argNameIdx = recArgStartIdx + i;
      if (argNameIdx < indexArgNames.length) {
        const argName = indexArgNames[argNameIdx];
        const checkedRecArgValue = valInContext(currentCtx, checkedRecArgCore);
        currentCtx = bindVal(currentCtx, argName, recArgTypeValue, checkedRecArgValue);
      }
    }
    return new go(new Constructor2(
      this.constructorName,
      ctorType.index,
      ctorType.type,
      normalized_args,
      normalized_rec_args
    ));
  }
};

// src/pie_interpreter/typechecker/definedatatype.ts
function isRecursiveArgumentType(argType, datatypeName) {
  if (argType instanceof Name && argType.name === datatypeName) {
    return true;
  }
  if (argType instanceof GeneralTypeConstructor && argType.name === datatypeName) {
    return true;
  }
  return false;
}
var DefineDatatypeSource = class {
  constructor(location, name, parameters, indices, constructors, eliminatorName) {
    this.location = location;
    this.name = name;
    this.parameters = parameters;
    this.indices = indices;
    this.constructors = constructors;
    this.eliminatorName = eliminatorName;
  }
  normalizeConstructor(ctx, rename2) {
    const validTypeTemp = new GeneralType(
      this.location,
      this.name,
      this.parameters,
      this.indices
    ).isType(ctx, rename2);
    if (validTypeTemp instanceof stop) {
      throw new Error(validTypeTemp.message.toString());
    }
    const validType = validTypeTemp.result;
    let extendedCtx = ctx;
    let extendedRename = rename2;
    for (const param of this.parameters) {
      const paramName = param.binder.varName;
      const paramTypeResult = param.type.isType(extendedCtx, extendedRename);
      if (paramTypeResult instanceof stop) {
        throw new Error(paramTypeResult.message.toString());
      }
      const paramTypeCore = paramTypeResult.result;
      const paramNameHat = fresh(extendedCtx, paramName);
      extendedCtx = bindFree(extendedCtx, paramNameHat, valInContext(extendedCtx, paramTypeCore));
      extendedRename = extendRenaming(extendedRename, paramName, paramNameHat);
    }
    const validValueType = valInContext(extendedCtx, validType);
    extendedCtx = extendContext(
      extendedCtx,
      this.name,
      new InductiveDatatypeBinder(this.name, validValueType)
    );
    const normalized_constructor = [];
    for (let i = 0; i < this.constructors.length; i++) {
      normalized_constructor.push(
        this.constructors[i].checkValid(
          extendedCtx,
          extendedRename,
          validValueType,
          i
        )
      );
    }
    let ret_ctx = ctx;
    let ret_rename = rename2;
    ret_ctx = extendContext(
      ret_ctx,
      this.name,
      new InductiveDatatypeBinder(this.name, validValueType)
    );
    normalized_constructor.forEach((element) => {
      const fresh_name = fresh(ret_ctx, element.name);
      const resultTypeValue = valInContext(extendedCtx, element.resultType);
      ret_ctx = extendContext(ret_ctx, fresh_name, new ConstructorTypeBinder(fresh_name, element, resultTypeValue));
      ret_rename = extendRenaming(ret_rename, element.name, fresh_name);
    });
    return [ret_ctx, ret_rename];
  }
};
var GeneralConstructor = class {
  constructor(location, name, args, returnType) {
    this.location = location;
    this.name = name;
    this.args = args;
    this.returnType = returnType;
  }
  checkValid(ctx, rename2, target, index) {
    let cur_ctx = ctx;
    let cur_rename = rename2;
    const normalized_args = [];
    const normalized_rec_args = [];
    const argNames = [];
    const rec_argNames = [];
    for (let i = 0; i < this.args.length; i++) {
      const argName = this.args[i].binder.varName;
      const xhat = fresh(cur_ctx, argName);
      const resultTemp = this.args[i].type.isType(cur_ctx, cur_rename);
      if (resultTemp instanceof stop) {
        throw new Error(resultTemp.message.toString());
      }
      const result = resultTemp.result;
      if (isRecursiveArgumentType(this.args[i].type, this.returnType.name)) {
        normalized_rec_args.push(result);
        rec_argNames.push(xhat);
      } else {
        normalized_args.push(result);
        argNames.push(xhat);
      }
      cur_ctx = bindFree(cur_ctx, xhat, valInContext(cur_ctx, result));
      cur_rename = extendRenaming(cur_rename, argName, xhat);
    }
    const returnTemp = this.returnType.check(cur_ctx, cur_rename, target);
    if (returnTemp instanceof stop) {
      throw new Error(returnTemp.message.toString());
    }
    const returnResult = returnTemp.result;
    return new ConstructorType2(
      this.name,
      index,
      this.returnType.name,
      normalized_args,
      normalized_rec_args,
      returnResult,
      argNames,
      rec_argNames
    );
  }
};

// src/pie_interpreter/tactics/tactics.ts
var Tactic = class {
  constructor(location) {
    this.location = location;
  }
};
var IntroTactic = class extends Tactic {
  constructor(location, varName) {
    super(location);
    this.location = location;
    this.varName = varName;
  }
  getName() {
    return "intro";
  }
  toString() {
    return `intro ${this.varName || ""}`;
  }
  apply(state) {
    const currentGoal = state.currentGoal.goal;
    const goalType = currentGoal.type;
    if (!(goalType instanceof Pi)) {
      return new stop(
        state.location,
        new Message([`Cannot introduce a variable for non-function type: ${goalType.prettyPrint()}`])
      );
    }
    const name = this.varName || goalType.argName || fresh(currentGoal.context, "x");
    const newRenaming = currentGoal.renaming;
    if (name !== goalType.argName) {
      extendRenaming(newRenaming, goalType.argName, name);
    }
    const newContext = extendContext(currentGoal.context, name, new Free(goalType.argType));
    const newGoalType = goalType.resultType.valOfClosure(
      new Neutral(goalType.argType, new Variable(name))
    );
    const newGoalNode = new GoalNode(new Goal(state.generateGoalId(), newGoalType, newContext, newRenaming));
    state.addGoal([newGoalNode]);
    return new go(state);
  }
};
var ExactTactic = class extends Tactic {
  constructor(location, term) {
    super(location);
    this.location = location;
    this.term = term;
  }
  toString() {
    return `exact ${this.term.prettyPrint()}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const goalType = currentGoal.type;
    const result = this.term.check(currentGoal.context, currentGoal.renaming, goalType);
    if (result instanceof stop) {
      return result;
    }
    state.currentGoal.isComplete = true;
    state.currentGoal.completedBy = this.toString();
    state.nextGoal();
    return new go(state);
  }
};
var ExistsTactic = class extends Tactic {
  constructor(location, value, varName) {
    super(location);
    this.location = location;
    this.value = value;
    this.varName = varName;
  }
  toString() {
    return `exists ${this.varName || ""}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const goalType = currentGoal.type;
    if (!(goalType instanceof Sigma)) {
      return new stop(
        state.location,
        new Message([`Cannot use exists on non-product type: ${goalType.prettyPrint()}`])
      );
    }
    const name = this.varName || goalType.carName || fresh(currentGoal.context, "x");
    const newRenaming = currentGoal.renaming;
    if (name !== goalType.carName) {
      extendRenaming(newRenaming, goalType.carName, name);
    }
    const result_temp = this.value.check(currentGoal.context, currentGoal.renaming, goalType.carType);
    if (result_temp instanceof stop) {
      return result_temp;
    }
    const result = result_temp.result.valOf(contextToEnvironment(currentGoal.context));
    const newContext = extendContext(currentGoal.context, name, new Define(goalType.carType, result));
    const newGoalType = goalType.cdrType.valOfClosure(
      result
    );
    const newGoalNode = new GoalNode(new Goal(state.generateGoalId(), newGoalType, newContext, newRenaming));
    state.addGoal([newGoalNode]);
    return new go(state);
  }
};
var EliminateNatTactic = class extends Tactic {
  constructor(location, target) {
    super(location);
    this.location = location;
    this.target = target;
  }
  toString() {
    return `ind-nat ${this.target}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const targetType_temp = currentGoal.context.get(this.target);
    if (!targetType_temp) {
      return new stop(state.location, new Message([`target not found in current context: ${this.target}`]));
    }
    let targetType;
    if (targetType_temp instanceof Free) {
      targetType = targetType_temp.type.now();
    } else {
      throw new Error(`Expected target to be a free variable`);
    }
    if (!(targetType instanceof Nat)) {
      return new stop(state.location, new Message([`Cannot eliminate non-Nat type: ${targetType.prettyPrint()}`]));
    }
    const motiveRst = this.generateNatMotive(currentGoal.context, currentGoal.type, this.target);
    const rst = this.eliminateNat(currentGoal.context, currentGoal.renaming, motiveRst);
    state.addGoal(
      rst.map((type) => {
        const newGoalNode = new GoalNode(
          new Goal(state.generateGoalId(), type, currentGoal.context, currentGoal.renaming)
        );
        return newGoalNode;
      })
    );
    return new go(state);
  }
  generateNatMotive(context, goal, targetVar) {
    const goalCore = goal.readBackType(context);
    const contextWithoutTarget = new Map(context);
    contextWithoutTarget.delete(targetVar);
    const env = contextToEnvironment(contextWithoutTarget);
    return new Lambda(
      targetVar,
      new FirstOrderClosure(env, targetVar, goalCore)
    );
  }
  eliminateNat(context, r, motiveType) {
    const baseType = doApp(motiveType, new Zero());
    const stepType = new Pi(
      fresh(context, "n-1"),
      new Nat(),
      new HigherOrderClosure((n_minus_1) => {
        return new Pi(
          fresh(context, "ih"),
          doApp(motiveType, n_minus_1),
          new HigherOrderClosure(
            (_) => doApp(motiveType, new Add1(n_minus_1))
          )
        );
      })
    );
    return [baseType, stepType];
  }
};
var EliminateListTactic = class extends Tactic {
  constructor(location, target, motive) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
  }
  toString() {
    return this.motive ? `ind-list ${this.target} to prove ${this.motive.prettyPrint()}` : `ind-list ${this.target}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const targetType_temp = currentGoal.context.get(this.target);
    if (!targetType_temp) {
      return new stop(state.location, new Message([`target not found in current context: ${this.target}`]));
    }
    let targetType;
    if (targetType_temp instanceof Free) {
      targetType = targetType_temp.type.now();
    } else {
      throw new Error(`Expected target to be a free variable`);
    }
    if (!(targetType instanceof List)) {
      return new stop(state.location, new Message([`Cannot eliminate non-List type: ${targetType.prettyPrint()}`]));
    }
    const E2 = targetType.entryType;
    let motiveType;
    if (this.motive) {
      const motiveRst = this.motive.check(
        currentGoal.context,
        currentGoal.renaming,
        new Pi(
          "xs",
          new List(E2),
          new FirstOrderClosure(
            contextToEnvironment(currentGoal.context),
            "xs",
            new Universe2()
          )
        )
      );
      if (motiveRst instanceof stop) {
        return motiveRst;
      }
      motiveType = motiveRst.result.valOf(contextToEnvironment(currentGoal.context));
    } else {
      motiveType = this.generateListMotive(currentGoal.context, currentGoal.type, this.target);
    }
    const rst = this.eliminateList(currentGoal.context, currentGoal.renaming, motiveType, E2);
    state.addGoal(
      rst.map((type) => {
        const newGoalNode = new GoalNode(
          new Goal(state.generateGoalId(), type, currentGoal.context, currentGoal.renaming)
        );
        return newGoalNode;
      })
    );
    return new go(state);
  }
  generateListMotive(context, goal, targetVar) {
    const goalCore = goal.readBackType(context);
    const contextWithoutTarget = new Map(context);
    contextWithoutTarget.delete(targetVar);
    const env = contextToEnvironment(contextWithoutTarget);
    return new Lambda(
      targetVar,
      new FirstOrderClosure(env, targetVar, goalCore)
    );
  }
  eliminateList(context, r, motiveType, entryType) {
    const baseType = doApp(motiveType, new Nil());
    const stepType = new Pi(
      fresh(context, "x"),
      entryType,
      new HigherOrderClosure(
        (x) => new Pi(
          fresh(context, "xs"),
          new List(entryType),
          new HigherOrderClosure(
            (xs) => new Pi(
              fresh(context, "ih"),
              doApp(motiveType, xs),
              new HigherOrderClosure(
                (_) => doApp(motiveType, new ListCons(x, xs))
              )
            )
          )
        )
      )
    );
    return [baseType, stepType];
  }
};
var EliminateVecTactic = class extends Tactic {
  constructor(location, target, motive, length) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
    this.length = length;
  }
  toString() {
    return `ind-list ${this.target} to prove ${this.motive.prettyPrint()}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const targetType_temp = currentGoal.context.get(this.target);
    if (!targetType_temp) {
      return new stop(state.location, new Message([`target not found in current context: ${this.target}`]));
    }
    let targetType;
    if (targetType_temp instanceof Free) {
      targetType = targetType_temp.type.now();
    } else {
      throw new Error(`Expected target to be a free variable`);
    }
    if (!(targetType instanceof Vec)) {
      return new stop(state.location, new Message([`Cannot eliminate non-Vec type: ${targetType.prettyPrint()}`]));
    }
    const lenout = this.length.check(currentGoal.context, currentGoal.renaming, new Nat());
    if (lenout instanceof stop) {
      return lenout;
    }
    const [E2, len2v] = [targetType.entryType, targetType.length];
    convert(
      currentGoal.context,
      this.location,
      new Nat(),
      valInContext(currentGoal.context, lenout.result),
      len2v
    );
    const motiveRst = this.motive.check(
      currentGoal.context,
      currentGoal.renaming,
      new Pi(
        "k",
        new Nat(),
        new HigherOrderClosure(
          (k) => new Pi(
            "es",
            new Vec(E2, k),
            new HigherOrderClosure(
              (_) => new Universe()
            )
          )
        )
      )
    );
    if (motiveRst instanceof stop) {
      return motiveRst;
    } else {
      const motiveType = motiveRst.result.valOf(contextToEnvironment(currentGoal.context));
      const rst = this.eliminateVec(currentGoal.context, currentGoal.renaming, motiveType, E2);
      state.addGoal(
        rst.map((type) => {
          const newGoalNode = new GoalNode(
            new Goal(state.generateGoalId(), type, currentGoal.context, currentGoal.renaming)
          );
          return newGoalNode;
        })
      );
      return new go(state);
    }
  }
  eliminateVec(context, r, motiveType, entryType) {
    const baseType = doApp(doApp(motiveType, new Zero()), new VecNil());
    const stepType = indVecStepType(entryType, motiveType);
    return [baseType, stepType];
  }
};
var EliminateEqualTactic = class extends Tactic {
  constructor(location, target, motive) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
  }
  toString() {
    return this.motive ? `ind-equal ${this.target} with motive ${this.motive.prettyPrint()}` : `ind-equal ${this.target}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const targetType_temp = currentGoal.context.get(this.target);
    if (!targetType_temp) {
      return new stop(state.location, new Message([`target not found in current context: ${this.target}`]));
    }
    let targetType;
    if (targetType_temp instanceof Free) {
      targetType = targetType_temp.type.now();
    } else {
      throw new Error(`Expected target to be a free variable`);
    }
    if (!(targetType instanceof Equal)) {
      return new stop(state.location, new Message([`Cannot eliminate non-Equal type: ${targetType.prettyPrint()}`]));
    }
    const [Av, fromv, tov] = [targetType.type, targetType.from, targetType.to];
    let motiveType;
    if (this.motive) {
      const motiveRst = this.motive.check(
        currentGoal.context,
        currentGoal.renaming,
        new Pi(
          "to",
          Av,
          new HigherOrderClosure(
            (to) => new Pi(
              "p",
              new Equal(Av, fromv, to),
              new HigherOrderClosure(
                (_) => new Universe()
              )
            )
          )
        )
      );
      if (motiveRst instanceof stop) {
        return motiveRst;
      }
      motiveType = motiveRst.result.valOf(contextToEnvironment(currentGoal.context));
    } else {
      return new stop(this.location, new Message([`Motive required for = elimination (too complex for auto-generation)`]));
    }
    const rst = [doApp(doApp(motiveType, fromv), new Same(fromv))];
    state.addGoal(
      rst.map((type) => {
        const newGoalNode = new GoalNode(
          new Goal(state.generateGoalId(), type, currentGoal.context, currentGoal.renaming)
        );
        return newGoalNode;
      })
    );
    return new go(state);
  }
};
var LeftTactic = class extends Tactic {
  constructor(location) {
    super(location);
    this.location = location;
  }
  toString() {
    return `left`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    if (!(currentGoal.type.now() instanceof Either)) {
      return new stop(state.location, new Message([`"left" expected goal type to be Either, but got: ${currentGoal.type.prettyPrint()}`]));
    }
    const leftType = currentGoal.type.leftType.now();
    state.addGoal([new GoalNode(
      new Goal(
        state.generateGoalId(),
        leftType,
        currentGoal.context,
        currentGoal.renaming
      )
    )]);
    return new go(state);
  }
};
var RightTactic = class extends Tactic {
  constructor(location) {
    super(location);
    this.location = location;
  }
  toString() {
    return `right`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    if (!(currentGoal.type.now() instanceof Either)) {
      return new stop(state.location, new Message([`"right" expected goal type to be Either, but got: ${currentGoal.type.prettyPrint()}`]));
    }
    const rightType = currentGoal.type.rightType.now();
    state.addGoal([new GoalNode(
      new Goal(
        state.generateGoalId(),
        rightType,
        currentGoal.context,
        currentGoal.renaming
      )
    )]);
    return new go(state);
  }
};
var EliminateEitherTactic = class extends Tactic {
  constructor(location, target, motive) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
  }
  toString() {
    return this.motive ? `ind-either ${this.target} with motive ${this.motive.prettyPrint()}` : `ind-either ${this.target}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const targetType_temp = currentGoal.context.get(this.target);
    if (!targetType_temp) {
      return new stop(state.location, new Message([`target not found in current context: ${this.target}`]));
    }
    let targetType;
    if (targetType_temp instanceof Free) {
      targetType = targetType_temp.type.now();
    } else {
      throw new Error(`Expected target to be a free variable`);
    }
    if (!(targetType instanceof Either)) {
      return new stop(state.location, new Message([`Cannot eliminate non-Either type: ${targetType.prettyPrint()}`]));
    }
    const [Lv, Rv] = [targetType.leftType, targetType.rightType];
    let motiveType;
    if (this.motive) {
      const motiveRst = this.motive.check(
        currentGoal.context,
        currentGoal.renaming,
        new Pi(
          "x",
          new Either(Lv, Rv),
          new HigherOrderClosure(
            (_) => new Universe()
          )
        )
      );
      if (motiveRst instanceof stop) {
        return motiveRst;
      }
      motiveType = motiveRst.result.valOf(contextToEnvironment(currentGoal.context));
    } else {
      motiveType = this.generateEitherMotive(currentGoal.context, currentGoal.type, this.target);
    }
    const leftType = new Pi(
      "x",
      Lv,
      new HigherOrderClosure(
        (x) => doApp(motiveType, new Left(x))
      )
    );
    const rightType = new Pi(
      "x",
      Rv,
      new HigherOrderClosure(
        (x) => doApp(motiveType, new Right(x))
      )
    );
    state.addGoal(
      [
        new GoalNode(
          new Goal(
            state.generateGoalId(),
            leftType,
            currentGoal.context,
            currentGoal.renaming
          )
        ),
        new GoalNode(
          new Goal(
            state.generateGoalId(),
            rightType,
            currentGoal.context,
            currentGoal.renaming
          )
        )
      ]
    );
    return new go(state);
  }
  generateEitherMotive(context, goal, targetVar) {
    const goalCore = goal.readBackType(context);
    const contextWithoutTarget = new Map(context);
    contextWithoutTarget.delete(targetVar);
    const env = contextToEnvironment(contextWithoutTarget);
    return new Lambda(
      targetVar,
      new FirstOrderClosure(env, targetVar, goalCore)
    );
  }
};
var SpiltTactic = class extends Tactic {
  constructor(location) {
    super(location);
  }
  toString() {
    return `split`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    if (!(currentGoal.type.now() instanceof Sigma)) {
      return new stop(state.location, new Message([`"split" expected goal type to be Sigma, but got: ${currentGoal.type.prettyPrint()}`]));
    }
    const pairType = currentGoal.type.now();
    const carType = pairType.carType.now();
    const cdrType = pairType.cdrType.valOfClosure(
      pairType
    );
    state.addGoal(
      [
        new GoalNode(
          new Goal(
            state.generateGoalId(),
            carType,
            currentGoal.context,
            currentGoal.renaming
          )
        ),
        new GoalNode(
          new Goal(
            state.generateGoalId(),
            cdrType,
            currentGoal.context,
            currentGoal.renaming
          )
        )
      ]
    );
    return new go(state);
  }
};
var EliminateAbsurdTactic = class extends Tactic {
  constructor(location, target, motive) {
    super(location);
    this.location = location;
    this.target = target;
    this.motive = motive;
  }
  toString() {
    return this.motive ? `ind-absurd ${this.target} with motive ${this.motive.prettyPrint()}` : `ind-absurd ${this.target}`;
  }
  apply(state) {
    const currentGoal = state.getCurrentGoal().result;
    const targetType_temp = currentGoal.context.get(this.target);
    if (!targetType_temp) {
      return new stop(state.location, new Message([`target not found in current context: ${this.target}`]));
    }
    let targetType;
    if (targetType_temp instanceof Free) {
      targetType = targetType_temp.type.now();
    } else {
      throw new Error(`Expected target to be a free variable`);
    }
    if (!(targetType instanceof Absurd)) {
      return new stop(state.location, new Message([`Cannot eliminate non-Absurd type: ${targetType.prettyPrint()}`]));
    }
    if (this.motive) {
      const motiveRst = this.motive.check(
        currentGoal.context,
        currentGoal.renaming,
        new Universe()
      );
      if (motiveRst instanceof stop) {
        return motiveRst;
      }
    }
    state.currentGoal.isComplete = true;
    state.currentGoal.completedBy = this.toString();
    state.nextGoal();
    return new go(state);
  }
};

// src/pie_interpreter/parser/makers.ts
function makeU(stx) {
  return new Universe3(syntaxToLocation(stx));
}
function makeArrow(stx, args) {
  return new Arrow(syntaxToLocation(stx), args[0], args[1], args[2]);
}
function makeNat(stx) {
  return new Nat3(syntaxToLocation(stx));
}
function makeZero(stx) {
  return new Zero3(syntaxToLocation(stx));
}
function makeAdd1(stx, n) {
  return new Add13(syntaxToLocation(stx), n);
}
function makeLambda(stx, binders, body) {
  return new Lambda3(syntaxToLocation(stx), binders, body);
}
function makePi(stx, binders, body) {
  return new Pi3(syntaxToLocation(stx), binders, body);
}
function makeSigma(stx, binders, body) {
  return new Sigma3(syntaxToLocation(stx), binders, body);
}
function makeTypedBinders(head, tail) {
  return [head, ...tail];
}
function makeApp2(stx, func, arg0, args) {
  return new Application3(syntaxToLocation(stx), func, arg0, args);
}
function makeAtom(stx) {
  return new Atom3(syntaxToLocation(stx));
}
function makeTrivial(stx) {
  return new Trivial3(syntaxToLocation(stx));
}
function makeSole(stx) {
  return new Sole3(syntaxToLocation(stx));
}
function makeList(stx, type) {
  return new List3(syntaxToLocation(stx), type);
}
function makeVec(stx, type, len) {
  return new Vec3(syntaxToLocation(stx), type, len);
}
function makeEither(stx, left, right) {
  return new Either3(syntaxToLocation(stx), left, right);
}
function makeNil(stx) {
  return new Nil3(syntaxToLocation(stx));
}
function makeVecCons(stx, head, tail) {
  return new VecCons3(syntaxToLocation(stx), head, tail);
}
function makeVecNil(stx) {
  return new VecNil3(syntaxToLocation(stx));
}
function makeAbsurd(stx) {
  return new Absurd3(syntaxToLocation(stx));
}
function makePair(stx, head, tail) {
  return new Pair(syntaxToLocation(stx), head, tail);
}
function makeCons(stx, head, tail) {
  return new Cons3(syntaxToLocation(stx), head, tail);
}
function makeListCons(stx, head, tail) {
  return new ListCons3(syntaxToLocation(stx), head, tail);
}
function makeThe(stx, type, value) {
  return new The2(syntaxToLocation(stx), type, value);
}
function makeIndAbsurd(stx, head, tail) {
  return new IndAbsurd3(syntaxToLocation(stx), head, tail);
}
function makeTrans(stx, from, to) {
  return new Trans3(syntaxToLocation(stx), from, to);
}
function makeCong(stx, from, to) {
  return new Cong3(syntaxToLocation(stx), from, to);
}
function makeIndEqual(stx, target, mot, base) {
  return new IndEqual3(syntaxToLocation(stx), target, mot, base);
}
function makeWhichNat(stx, target, base, step) {
  return new WhichNat3(syntaxToLocation(stx), target, base, step);
}
function makeIterNat(stx, target, base, step) {
  return new IterNat3(syntaxToLocation(stx), target, base, step);
}
function makeRecNat(stx, target, base, step) {
  return new RecNat3(syntaxToLocation(stx), target, base, step);
}
function makeIndNat(stx, target, mot, base, step) {
  return new IndNat3(syntaxToLocation(stx), target, mot, base, step);
}
function makeRecList(stx, target, base, step) {
  return new RecList3(syntaxToLocation(stx), target, base, step);
}
function makeIndList(stx, target, mot, base, step) {
  return new IndList3(syntaxToLocation(stx), target, mot, base, step);
}
function makeIndEither(stx, target, mot, base, step) {
  return new IndEither3(syntaxToLocation(stx), target, mot, base, step);
}
function makeIndVec(stx, length, target, mot, base, step) {
  return new IndVec3(syntaxToLocation(stx), length, target, mot, base, step);
}
function makeEqual(stx, type, left, right) {
  return new Equal3(syntaxToLocation(stx), type, left, right);
}
function makeReplace(stx, target, mot, base) {
  return new Replace3(syntaxToLocation(stx), target, mot, base);
}
function makeSymm(stx, equality) {
  return new Symm3(syntaxToLocation(stx), equality);
}
function makeHead(stx, vec) {
  return new Head3(syntaxToLocation(stx), vec);
}
function makeTail(stx, vec) {
  return new Tail3(syntaxToLocation(stx), vec);
}
function makeSame(stx, type) {
  return new Same3(syntaxToLocation(stx), type);
}
function makeLeft(stx, value) {
  return new Left3(syntaxToLocation(stx), value);
}
function makeRight(stx, value) {
  return new Right3(syntaxToLocation(stx), value);
}
function makeCar(stx, pair) {
  return new Car3(syntaxToLocation(stx), pair);
}
function makeCdr(stx, pair) {
  return new Cdr3(syntaxToLocation(stx), pair);
}
function makeQuote(stx, quoted) {
  return new Quote3(syntaxToLocation(stx), quoted);
}
function makeVarRef(stx, ref) {
  return new Name(syntaxToLocation(stx), ref);
}
function makeNatLiteral(stx, num) {
  return new Number2(syntaxToLocation(stx), Number(num));
}
function makeTODO(stx) {
  return new TODO3(syntaxToLocation(stx));
}
function makeIntro(stx, name) {
  return new IntroTactic(syntaxToLocation(stx), name);
}
function makeExact(stx, expr) {
  return new ExactTactic(syntaxToLocation(stx), expr);
}
function makeExists(stx, value, name) {
  return new ExistsTactic(syntaxToLocation(stx), value, name);
}
function makeElimNat(stx, target) {
  return new EliminateNatTactic(syntaxToLocation(stx), target);
}
function makeElimList(stx, target, motive) {
  return new EliminateListTactic(syntaxToLocation(stx), target, motive);
}
function makeElimVec(stx, target, motive, length) {
  return new EliminateVecTactic(syntaxToLocation(stx), target, motive, length);
}
function makeElimEqual(stx, target, motive) {
  return new EliminateEqualTactic(syntaxToLocation(stx), target, motive);
}
function makeLeftTactic(stx) {
  return new LeftTactic(syntaxToLocation(stx));
}
function makeRightTactic(stx) {
  return new RightTactic(syntaxToLocation(stx));
}
function makeElimEither(stx, target, motive) {
  return new EliminateEitherTactic(syntaxToLocation(stx), target, motive);
}
function makeSplit(stx) {
  return new SpiltTactic(syntaxToLocation(stx));
}
function makeElimAbsurd(stx, target, motive) {
  return new EliminateAbsurdTactic(syntaxToLocation(stx), target, motive);
}
function makeConstructorApplication(stx, constructorName, args) {
  return new ConstructorApplication(
    syntaxToLocation(stx),
    constructorName,
    args
  );
}
function makeEliminatorApplication(stx, typeName, target, motive, methods) {
  return new EliminatorApplication(
    syntaxToLocation(stx),
    typeName,
    target,
    motive,
    methods
  );
}
function makeGeneralTypeConstructor(stx, name, params, indices) {
  return new GeneralTypeConstructor(
    syntaxToLocation(stx),
    name,
    params,
    indices
  );
}

// src/pie_interpreter/parser/parser.ts
function syntaxToLocation(syntax) {
  return new Location2(
    syntax,
    true
  );
}
function syntaxToSiteBinder(syntax) {
  return new SiteBinder(
    syntaxToLocation(syntax),
    syntax.source
  );
}
function getValue(element) {
  if (element instanceof Atomic.Symbol) {
    return element.value;
  } else if (element instanceof Atomic.NumericLiteral) {
    return element.value;
  } else if (element instanceof Extended.List) {
    return getValue(element.elements[0]);
  } else if (element instanceof Atomic.Nil) {
    return "()";
  } else {
    const elem = element;
    throw new Error(`Expected a Element, but got: ${JSON.stringify(elem)} (type: ${typeof elem}, constructor: ${elem?.constructor?.name})`);
  }
}
function locationToSyntax(source, location) {
  return new Syntax(
    location.start,
    location.end,
    source
  );
}
function elementToSyntax(element, location) {
  return locationToSyntax(getValue(element), location);
}
function schemeParse(stx) {
  const lexer = new SchemeLexer(stx);
  const parser = new SchemeParser("", lexer.scanTokens());
  const ast = parser.parse();
  return ast;
}
var Parser = class _Parser {
  static parsePie(stx) {
    return _Parser.parseElements(schemeParse(stx)[0]);
  }
  static parseElements(element) {
    const parsee = getValue(element);
    if (parsee === "U") {
      return makeU(locationToSyntax("U", element.location));
    } else if (parsee === "the") {
      const elements = element.elements;
      const loc = element.location;
      return makeThe(
        locationToSyntax("the", loc),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "Nat") {
      return makeNat(locationToSyntax("Nat", element.location));
    } else if (parsee === "zero") {
      return makeZero(locationToSyntax("zero", element.location));
    } else if (parsee === "add1") {
      return makeAdd1(
        locationToSyntax("add1", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "->" || parsee === "\u2192") {
      const elements = element.elements;
      const loc = element.location;
      return makeArrow(
        locationToSyntax("->", loc),
        [
          this.parseElements(elements[1]),
          this.parseElements(elements[2]),
          elements.slice(3).map((x) => this.parseElements(x))
        ]
      );
    } else if (parsee === "lambda" || parsee === "\u03BB") {
      const elements = element.elements;
      const loc = element.location;
      const args = elements[1];
      const body = elements[2];
      return makeLambda(
        locationToSyntax("\u03BB", loc),
        args.elements.map(
          (x) => syntaxToSiteBinder(
            elementToSyntax(x, element.location)
          )
        ),
        this.parseElements(body)
      );
    } else if (parsee === "Pi" || parsee === "\u03A0") {
      const elements = element.elements;
      const args = elements[1];
      const body = elements[2];
      const firstPair = args.elements[0];
      const x0 = firstPair.elements[0];
      const A0 = firstPair.elements[1];
      const remainingPairs = args.elements.slice(1);
      const processedPairs = remainingPairs.map((pair) => {
        const x = pair.elements[0];
        const A = pair.elements[1];
        return new TypedBinder(
          syntaxToSiteBinder(elementToSyntax(x, pair.location)),
          this.parseElements(A)
        );
      });
      return makePi(
        locationToSyntax("\u03A0", element.location),
        makeTypedBinders(
          new TypedBinder(
            syntaxToSiteBinder(elementToSyntax(x0, firstPair.location)),
            this.parseElements(A0)
          ),
          processedPairs
        ),
        this.parseElements(body)
      );
    } else if (parsee === "Sigma" || parsee === "\u03A3") {
      const elements = element.elements;
      const args = elements[1];
      const body = elements[2];
      const firstPair = args.elements[0];
      const x0 = firstPair.elements[0];
      const A0 = firstPair.elements[1];
      const remainingPairs = args.elements.slice(1);
      const processedPairs = remainingPairs.map((pair) => {
        const x = pair.elements[0];
        const A = pair.elements[1];
        return new TypedBinder(
          syntaxToSiteBinder(elementToSyntax(x, pair.location)),
          this.parseElements(A)
        );
      });
      return makeSigma(
        locationToSyntax("\u03A0", element.location),
        makeTypedBinders(
          new TypedBinder(
            syntaxToSiteBinder(elementToSyntax(x0, firstPair.location)),
            this.parseElements(A0)
          ),
          processedPairs
        ),
        this.parseElements(body)
      );
    } else if (parsee === "Pair") {
      const elements = element.elements;
      return makePair(
        locationToSyntax("Pair", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "cons") {
      const elements = element.elements;
      return makeCons(
        locationToSyntax("Cons", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "car") {
      return makeCar(
        locationToSyntax("car", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "cdr") {
      return makeCdr(
        locationToSyntax("cdr", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "which-Nat") {
      const elements = element.elements;
      return makeWhichNat(
        locationToSyntax("which-Nat", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "iter-Nat") {
      const elements = element.elements;
      return makeIterNat(
        locationToSyntax("iter-Nat", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "rec-Nat") {
      const elements = element.elements;
      return makeRecNat(
        locationToSyntax("rec-Nat", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "ind-Nat") {
      const elements = element.elements;
      return makeIndNat(
        locationToSyntax("ind-Nat", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3]),
        this.parseElements(elements[4])
      );
    } else if (parsee === "Atom") {
      return makeAtom(locationToSyntax("Atom", element.location));
    } else if (parsee === "quote") {
      return makeQuote(
        locationToSyntax("Quote", element.location),
        getValue(element.elements[1])
      );
    } else if (parsee === "Trivial") {
      return makeTrivial(locationToSyntax("Trivial", element.location));
    } else if (parsee === "sole") {
      return makeSole(locationToSyntax("sole", element.location));
    } else if (parsee === "List") {
      return makeList(
        locationToSyntax("List", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "nil") {
      return makeNil(locationToSyntax("nil", element.location));
    } else if (parsee === "::") {
      const elements = element.elements;
      return makeListCons(
        locationToSyntax("::", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "rec-List") {
      const elements = element.elements;
      return makeRecList(
        locationToSyntax("rec-List", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "ind-List") {
      const elements = element.elements;
      return makeIndList(
        locationToSyntax("ind-List", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3]),
        this.parseElements(elements[4])
      );
    } else if (parsee === "=") {
      const elements = element.elements;
      return makeEqual(
        locationToSyntax("=", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "same") {
      return makeSame(
        locationToSyntax("same", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "replace") {
      const elements = element.elements;
      return makeReplace(
        locationToSyntax("replace", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "trans") {
      const elements = element.elements;
      return makeTrans(
        locationToSyntax("trans", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "cong") {
      const elements = element.elements;
      return makeCong(
        locationToSyntax("cong", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "ind-=") {
      const elements = element.elements;
      return makeIndEqual(
        locationToSyntax("ind-=", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3])
      );
    } else if (parsee === "symm") {
      return makeSymm(
        locationToSyntax("symm", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "Vec") {
      const elements = element.elements;
      return makeVec(
        locationToSyntax("Vec", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "vecnil") {
      return makeVecNil(
        locationToSyntax("vecnil", element.location)
      );
    } else if (parsee === "vec::") {
      const elements = element.elements;
      return makeVecCons(
        locationToSyntax("vec::", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "head") {
      return makeHead(
        locationToSyntax("head", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "tail") {
      return makeTail(
        locationToSyntax("tail", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "ind-Vec") {
      const elements = element.elements;
      return makeIndVec(
        locationToSyntax("ind-Vec", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3]),
        this.parseElements(elements[4]),
        this.parseElements(elements[5])
      );
    } else if (parsee === "Either") {
      const elements = element.elements;
      return makeEither(
        locationToSyntax("Either", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "left") {
      return makeLeft(
        locationToSyntax("left", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "right") {
      return makeRight(
        locationToSyntax("right", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "ind-Either") {
      const elements = element.elements;
      return makeIndEither(
        locationToSyntax("ind-Either", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2]),
        this.parseElements(elements[3]),
        this.parseElements(elements[4])
      );
    } else if (parsee === "Absurd") {
      return makeAbsurd(
        locationToSyntax("Absurd", element.location)
      );
    } else if (parsee === "ind-Absurd") {
      const elements = element.elements;
      return makeIndAbsurd(
        locationToSyntax("ind-Absurd", element.location),
        this.parseElements(elements[1]),
        this.parseElements(elements[2])
      );
    } else if (parsee === "TODO") {
      return makeTODO(locationToSyntax("TODO", element.location));
    } else if (parsee.startsWith("ind-") && element instanceof Extended.List && element.elements[0] instanceof Atomic.Symbol) {
      const typeName = parsee.substring(4);
      const elements = element.elements;
      if (elements.length < 3) {
        throw new Error(`Eliminator ${parsee} requires at least target and motive`);
      }
      const target = this.parseElements(elements[1]);
      const motive = this.parseElements(elements[2]);
      const methods = elements.slice(3).map((x) => this.parseElements(x));
      return makeEliminatorApplication(
        locationToSyntax(parsee, element.location),
        typeName,
        target,
        motive,
        methods
      );
    } else if (element instanceof Extended.List && element.elements.length >= 3) {
      const elements = element.elements;
      const firstElem = elements[0];
      if (firstElem instanceof Atomic.Symbol) {
        const name = firstElem.value;
        if (name && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase() && elements.length === 3) {
          const secondElem = elements[1];
          const thirdElem = elements[2];
          if ((secondElem instanceof Extended.List || secondElem instanceof Atomic.Nil) && (thirdElem instanceof Extended.List || thirdElem instanceof Atomic.Nil)) {
            let params = [];
            if (secondElem instanceof Extended.List) {
              params = (secondElem.elements || []).map((p) => this.parseElements(p));
            }
            let indices = [];
            if (thirdElem instanceof Extended.List) {
              indices = (thirdElem.elements || []).map((idx) => this.parseElements(idx));
            }
            return makeGeneralTypeConstructor(
              locationToSyntax(name, element.location),
              name,
              params,
              indices
            );
          }
        }
      }
      return makeApp2(
        locationToSyntax("App", element.location),
        this.parseElements(elements[0]),
        this.parseElements(elements[1]),
        elements.slice(2).map(
          (x) => this.parseElements(x)
        )
      );
    } else if (element instanceof Extended.List && element.elements.length > 1) {
      const elements = element.elements;
      return makeApp2(
        locationToSyntax("App", element.location),
        this.parseElements(elements[0]),
        this.parseElements(elements[1]),
        elements.slice(2).map(
          (x) => this.parseElements(x)
        )
      );
    } else if (element instanceof Extended.List && element.elements.length === 1) {
      const elements = element.elements;
      const name = getValue(elements[0]);
      return makeConstructorApplication(
        locationToSyntax(name, element.location),
        name,
        []
      );
    } else if (isVarName(parsee)) {
      return makeVarRef(locationToSyntax(parsee, element.location), parsee);
    } else if (!isNaN(Number(parsee))) {
      return makeNatLiteral(locationToSyntax(parsee, element.location), parsee);
    }
    throw new Error("Unexpected element: " + element);
  }
  static parseToTactics(element) {
    const parsee = getValue(element);
    if (parsee === "exact") {
      return makeExact(
        locationToSyntax("exact", element.location),
        this.parseElements(element.elements[1])
      );
    } else if (parsee === "intro") {
      return makeIntro(
        locationToSyntax("intro", element.location),
        element.elements[1].value
      );
    } else if (parsee === "exists") {
      return makeExists(
        locationToSyntax("exists", element.location),
        this.parseElements(element.elements[1]),
        element.elements[2].value
      );
    } else if (parsee === "elimNat") {
      return makeElimNat(
        locationToSyntax("elimNat", element.location),
        element.elements[1].value
      );
    } else if (parsee === "elimList") {
      const listElem = element;
      return makeElimList(
        locationToSyntax("elimList", element.location),
        listElem.elements[1].value,
        listElem.elements[2] ? this.parseElements(listElem.elements[2]) : void 0
      );
    } else if (parsee === "elimVec") {
      return makeElimVec(
        locationToSyntax("elimVec", element.location),
        element.elements[1].value,
        this.parseElements(element.elements[2]),
        this.parseElements(element.elements[3])
      );
    } else if (parsee === "elimEqual") {
      const equalElem = element;
      return makeElimEqual(
        locationToSyntax("elimEqual", element.location),
        equalElem.elements[1].value,
        equalElem.elements[2] ? this.parseElements(equalElem.elements[2]) : void 0
      );
    } else if (parsee === "left") {
      return makeLeftTactic(
        locationToSyntax("left", element.location)
      );
    } else if (parsee === "right") {
      return makeRightTactic(
        locationToSyntax("right", element.location)
      );
    } else if (parsee === "elimEither") {
      const eitherElem = element;
      return makeElimEither(
        locationToSyntax("elimEither", element.location),
        eitherElem.elements[1].value,
        eitherElem.elements[2] ? this.parseElements(eitherElem.elements[2]) : void 0
      );
    } else if (parsee === "split") {
      return makeSplit(
        locationToSyntax("split", element.location)
      );
    } else if (parsee === "elimAbsurd") {
      const absurdElem = element;
      return makeElimAbsurd(
        locationToSyntax("elimAbsurd", element.location),
        absurdElem.elements[1].value,
        absurdElem.elements[2] ? this.parseElements(absurdElem.elements[2]) : void 0
      );
    }
    throw new Error("Unexpected tactic: " + element);
  }
};
var Claim2 = class {
  constructor(location, name, type) {
    this.location = location;
    this.name = name;
    this.type = type;
  }
};
var Definition = class {
  constructor(location, name, expr) {
    this.location = location;
    this.name = name;
    this.expr = expr;
  }
};
var SamenessCheck = class {
  constructor(location, type, left, right) {
    this.location = location;
    this.type = type;
    this.left = left;
    this.right = right;
  }
};
var DefineTactically = class {
  constructor(location, name, tactics) {
    this.location = location;
    this.name = name;
    this.tactics = tactics;
  }
};
var pieDeclarationParser = class {
  static parseDeclaration(ast) {
    const parsee = getValue(ast);
    if (parsee === "claim") {
      const elements = ast.elements;
      return new Claim2(
        syntaxToLocation(elementToSyntax(elements[0], ast.location)),
        getValue(elements[1]),
        Parser.parseElements(elements[2])
      );
    } else if (parsee === "define") {
      const elements = ast.elements;
      return new Definition(
        syntaxToLocation(elementToSyntax(elements[0], ast.location)),
        getValue(elements[1]),
        Parser.parseElements(elements[2])
      );
    } else if (parsee === "check-same") {
      const elements = ast.elements;
      return new SamenessCheck(
        syntaxToLocation(elementToSyntax(elements[0], ast.location)),
        Parser.parseElements(elements[1]),
        Parser.parseElements(elements[2]),
        Parser.parseElements(elements[3])
      );
    } else if (parsee === "define-tactically") {
      const elements = ast.elements;
      return new DefineTactically(
        syntaxToLocation(elementToSyntax(elements[0], ast.location)),
        getValue(elements[1]),
        elements[2].elements.map((x) => Parser.parseToTactics(x))
      );
    } else if (parsee === "data") {
      const elements = ast.elements;
      const loc = ast.location;
      const typeName = getValue(elements[1]);
      const paramsRaw = elements[2].elements || [];
      const indicesRaw = elements[3].elements || [];
      const parameters = paramsRaw.map((p) => {
        const pair = p;
        return new TypedBinder(
          syntaxToSiteBinder(elementToSyntax(pair.elements[0], pair.location)),
          Parser.parseElements(pair.elements[1])
        );
      });
      const indices = indicesRaw.map((idx) => {
        const pair = idx;
        return new TypedBinder(
          syntaxToSiteBinder(elementToSyntax(pair.elements[0], pair.location)),
          Parser.parseElements(pair.elements[1])
        );
      });
      const lastElement = elements[elements.length - 1];
      const hasEliminator = lastElement instanceof Atomic.Symbol;
      const constructorEndIdx = hasEliminator ? elements.length - 1 : elements.length;
      const eliminatorName = hasEliminator ? getValue(lastElement) : void 0;
      const constructors = [];
      for (let i = 4; i < constructorEndIdx; i++) {
        const ctorElement = elements[i];
        const ctorName = getValue(ctorElement.elements[0]);
        const ctorArgsElem = ctorElement.elements[1];
        let ctorArgsRaw = [];
        if (ctorArgsElem instanceof Extended.List) {
          ctorArgsRaw = ctorArgsElem.elements || [];
        } else if (ctorArgsElem instanceof Atomic.Nil) {
          ctorArgsRaw = [];
        }
        const ctorReturnType = ctorElement.elements[2];
        const ctorArgs = ctorArgsRaw.map((arg) => {
          const pair = arg;
          const argType = pair.elements[1];
          const parsedArgType = Parser.parseElements(argType);
          return new TypedBinder(
            syntaxToSiteBinder(elementToSyntax(pair.elements[0], pair.location)),
            parsedArgType
          );
        });
        const returnTypeList = ctorReturnType;
        const returnTypeName = getValue(returnTypeList.elements[0]);
        if (returnTypeList.elements.length < 3) {
          throw new Error(`Constructor return type must specify parameters and indices: (${returnTypeName} (params...) (indices...))`);
        }
        const returnParamsElem = returnTypeList.elements[1];
        let returnParams = [];
        if (returnParamsElem instanceof Extended.List) {
          returnParams = (returnParamsElem.elements || []).map((p) => Parser.parseElements(p));
        } else if (returnParamsElem instanceof Atomic.Nil) {
          returnParams = [];
        }
        const returnIndicesElem = returnTypeList.elements[2];
        let returnIndices = [];
        if (returnIndicesElem instanceof Extended.List) {
          returnIndices = (returnIndicesElem.elements || []).map((idx) => Parser.parseElements(idx));
        } else if (returnIndicesElem instanceof Atomic.Nil) {
          returnIndices = [];
        }
        const returnType = makeGeneralTypeConstructor(
          elementToSyntax(returnTypeList.elements[0], returnTypeList.location),
          returnTypeName,
          returnParams,
          returnIndices
        );
        constructors.push(
          new GeneralConstructor(
            syntaxToLocation(elementToSyntax(ctorElement.elements[0], ctorElement.location)),
            ctorName,
            ctorArgs,
            returnType
          )
        );
      }
      return new DefineDatatypeSource(
        syntaxToLocation(elementToSyntax(elements[0], loc)),
        typeName,
        parameters,
        indices,
        constructors,
        eliminatorName
      );
    } else {
      return Parser.parseElements(ast);
    }
  }
};

// src/pie_interpreter/typechecker/represent.ts
function represent(ctx, expr) {
  const outmeta = new PerhapsM("outmeta");
  return goOn(
    [[outmeta, () => expr.synth(ctx, /* @__PURE__ */ new Map())]],
    () => {
      const tv = valInContext(ctx, outmeta.value.type);
      const v = valInContext(ctx, outmeta.value.expr);
      return new go(
        new The(tv.readBackType(ctx), readBack(ctx, tv, v))
      );
    }
  );
}
function checkSame(ctx, where, t, a, b) {
  const typeOut = new PerhapsM("tOut");
  const typeValue = new PerhapsM("tv");
  const leftOut = new PerhapsM("aOut");
  const rightOut = new PerhapsM("bOut");
  const leftValue = new PerhapsM("av");
  const rightValue = new PerhapsM("bv");
  return goOn(
    [
      [typeOut, () => t.isType(ctx, /* @__PURE__ */ new Map())],
      [typeValue, () => new go(valInContext(ctx, typeOut.value))],
      [leftOut, () => a.check(ctx, /* @__PURE__ */ new Map(), typeValue.value)],
      [rightOut, () => b.check(ctx, /* @__PURE__ */ new Map(), typeValue.value)],
      [leftValue, () => new go(valInContext(ctx, leftOut.value))],
      [rightValue, () => new go(valInContext(ctx, rightOut.value))]
    ],
    () => {
      return convert(ctx, where, typeValue.value, leftValue.value, rightValue.value);
    }
  );
}

// src/pie_interpreter/unparser/pretty.ts
function prettyPrintCore(expr) {
  return expr.prettyPrint();
}

// src/pie_interpreter/main.js
function evaluatePie(str) {
  const astList = schemeParse(str);
  let ctx = initCtx;
  let renaming = /* @__PURE__ */ new Map();
  let output = "";
  for (const ast of astList) {
    const src = pieDeclarationParser.parseDeclaration(ast);
    if (src instanceof Claim2) {
      const result = addClaimToContext(ctx, src.name, src.location, src.type);
      if (result instanceof go) {
        ctx = result.result;
      } else if (result instanceof stop) {
        throw new Error("" + result.where + result.message);
      }
    } else if (src instanceof Definition) {
      const result = addDefineToContext(ctx, src.name, src.location, src.expr);
      if (result instanceof go) {
        ctx = result.result;
      } else if (result instanceof stop) {
        throw new Error("" + result.where + result.message);
      }
    } else if (src instanceof SamenessCheck) {
      const result = checkSame(ctx, src.location, src.type, src.left, src.right);
      if (result instanceof go) {
      } else if (result instanceof stop) {
        throw new Error("" + result.where + result.message);
      }
    } else if (src instanceof DefineDatatypeSource) {
      const [newCtx, newRenaming] = src.normalizeConstructor(ctx, renaming);
      ctx = newCtx;
      renaming = newRenaming;
    } else if (src instanceof DefineTactically) {
      const result = addDefineTacticallyToContext(ctx, src.name, src.location, src.tactics);
      if (result instanceof go) {
        ctx = result.result.context;
        output += result.result.message;
      } else if (result instanceof stop) {
        throw new Error("" + result.where + result.message);
      }
    } else {
      const result = represent(ctx, src);
      if (result instanceof go) {
        const core = result.result;
        output += `${prettyPrintCore(core.expr)}: ${prettyPrintCore(core.type)}
`;
      } else if (result instanceof stop) {
        throw new Error(`${result.message} at ${result.where}`);
      }
    }
  }
  for (const [name, binder] of ctx) {
    if (binder instanceof Define) {
      output += name + " : " + prettyPrintCore(binder.type.readBackType(ctx)) + "\n";
      output += name + " = " + prettyPrintCore(readBack(ctx, binder.type, binder.value)) + "\n";
    } else {
      output += name + " : " + prettyPrintCore(binder.type.readBackType(ctx)) + "\n";
    }
  }
  return output;
}

// src/lib_runner.ts
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var LIB_FILES = [
  "nat.pie",
  "pair.pie",
  "list.pie",
  "vec.pie"
];
function getLibraryCode() {
  let combinedCode = "";
  let libDir = path.join(__dirname, "lib");
  if (!fs.existsSync(libDir)) {
    libDir = path.join(process.cwd(), "src", "lib");
  }
  console.log("DEBUG: Using libDir:", libDir);
  console.log("DEBUG: Exists?", fs.existsSync(libDir));
  for (const file of LIB_FILES) {
    const filePath = path.join(libDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const cleanContent = content.split("\n").filter((line) => !line.trim().startsWith("#lang")).join("\n");
      combinedCode += `
;;; --- Begin ${file} ---
`;
      combinedCode += cleanContent;
      combinedCode += `
;;; --- End ${file} ---
`;
    } catch (error) {
      console.error(`Error reading library file ${file}:`, error);
      throw error;
    }
  }
  return combinedCode;
}
function runWithLib(userCode) {
  const libCode = getLibraryCode();
  const cleanUserCode = userCode.split("\n").filter((line) => !line.trim().startsWith("#lang")).join("\n");
  return evaluatePie(libCode + "\n" + cleanUserCode);
}

// src/check_lib.ts
var testCode = `
(claim test-vec (Vec Nat 2))
(define test-vec
  (vec:: 1 (vec:: 2 vecnil)))

(claim len-2 Nat)
(define len-2 2)

(first Nat 1 test-vec)
`;
console.log("Running test with library...");
try {
  const result = runWithLib(testCode);
  console.log("Result:", result);
} catch (e) {
  console.error("Error running library test:", e);
}
