// Neon Scientific Calculator (no external libs)
// Features: expression builder, safe-ish evaluator via tokenizing + shunting-yard + RPN
// Supports: + - × ÷, parentheses, %, ^, sqrt, sin/cos/tan, asin/acos/atan (2nd), log10, ln, factorial, inv 1/x
// Constants: π, e, Ans
// DEG/RAD modes, history, keyboard support

const exprEl = document.getElementById("expr");
const resultEl = document.getElementById("result");
const hintEl = document.getElementById("hint");

const historyListEl = document.getElementById("historyList");

const btnDeg = document.getElementById("btnDeg");
const btnRad = document.getElementById("btnRad");
const btn2nd = document.getElementById("btn2nd");
const btnClearHistory = document.getElementById("btnClearHistory");

const modePill = document.getElementById("modePill");
const secondPill = document.getElementById("secondPill");
const ansPill = document.getElementById("ansPill");

let state = {
  expr: "",
  ans: 0,
  mode: "DEG",   // DEG | RAD
  second: false,
  history: []    // {expr, result}
};

// ---------- Utilities ----------
function setHint(text){
  hintEl.textContent = text;
}
function setExpr(text){
  state.expr = text;
  exprEl.textContent = state.expr || "";
}
function setResult(text){
  resultEl.textContent = text;
}
function isDigit(ch){ return ch >= "0" && ch <= "9"; }

function formatNumber(n){
  if (!Number.isFinite(n)) return "Error";
  // prevent -0
  if (Object.is(n, -0)) n = 0;
  // show up to 12 significant digits, trim
  const s = Number(n.toPrecision(12)).toString();
  return s;
}

function degToRad(x){ return x * Math.PI / 180; }
function radToDeg(x){ return x * 180 / Math.PI; }

function factorial(n){
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return NaN;
  if (Math.abs(n - Math.round(n)) > 1e-12) return NaN; // require integer
  n = Math.round(n);
  if (n > 170) return Infinity; // JS overflow for factorial
  let r = 1;
  for (let i=2;i<=n;i++) r *= i;
  return r;
}

// ---------- Tokenizer ----------
/*
Tokens:
- number: {type:"num", value: number}
- operator: {type:"op", value:"+|-|*|/|^|%|u-" } (u- = unary minus)
- paren: {type:"paren", value:"("|")"}
- func: {type:"fn", value:"sin|cos|tan|asin|acos|atan|log|ln|sqrt|inv"}
- const: {type:"const", value:"pi|e|ans"}
*/
function normalizeInput(raw){
  return raw
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("−", "-")
    .replaceAll("π", "pi")
    .replaceAll("Ans", "ans");
}

function tokenize(input){
  const s = normalizeInput(input).replace(/\s+/g, "");
  const out = [];
  let i = 0;

  const isAlpha = (c)=> (c>="a" && c<="z") || (c>="A" && c<="Z") ;

  while (i < s.length){
    const c = s[i];

    // number (supports decimals)
    if (isDigit(c) || (c === ".")){
      let j = i;
      let dot = 0;
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")){
        if (s[j] === ".") dot++;
        if (dot > 1) break;
        j++;
      }
      const numStr = s.slice(i, j);
      const num = Number(numStr);
      if (!Number.isFinite(num)) throw new Error("Invalid number");
      out.push({type:"num", value:num});
      i = j;
      continue;
    }

    // parentheses
    if (c === "(" || c === ")"){
      out.push({type:"paren", value:c});
      i++;
      continue;
    }

    // operators
    if ("+-*/^%".includes(c)){
      out.push({type:"op", value:c});
      i++;
      continue;
    }

    // identifiers (functions/constants)
    if (isAlpha(c)){
      let j = i;
      while (j < s.length && (isAlpha(s[j]))) j++;
      const id = s.slice(i, j).toLowerCase();

      // constants
      if (id === "pi") out.push({type:"const", value:"pi"});
      else if (id === "e") out.push({type:"const", value:"e"});
      else if (id === "ans") out.push({type:"const", value:"ans"});
      // functions
      else if (["sin","cos","tan","asin","acos","atan","log","ln","sqrt","inv"].includes(id)){
        out.push({type:"fn", value:id});
      } else {
        throw new Error("Unknown identifier: " + id);
      }
      i = j;
      continue;
    }

    // factorial shorthand "!" handled in UI via function, but allow in expression too
    if (c === "!"){
      out.push({type:"fn", value:"fact"}); // treat as postfix fn, handled specially
      i++;
      continue;
    }

    throw new Error("Unexpected char: " + c);
  }

  return insertImplicitMultiplication(markUnaryMinus(out));
}

function markUnaryMinus(tokens){
  // Convert "-" to unary u- when at start or after operator or "("
  const out = [];
  for (let i=0;i<tokens.length;i++){
    const t = tokens[i];
    if (t.type === "op" && t.value === "-"){
      const prev = out[out.length - 1];
      if (!prev || (prev.type === "op") || (prev.type === "paren" && prev.value === "(")){
        out.push({type:"op", value:"u-"});
      } else out.push(t);
    } else {
      out.push(t);
    }
  }
  return out;
}

function insertImplicitMultiplication(tokens){
  // Examples: 2(pi) -> 2 * (pi), 2sin(30) -> 2 * sin(30), (2)(3) -> (2) * (3), pi2 -> pi * 2 (handled)
  const out = [];
  const canLeft = (t)=> t && (t.type==="num" || t.type==="const" || (t.type==="paren" && t.value===")"));
  const canRight = (t)=> t && (t.type==="num" || t.type==="const" || t.type==="fn" || (t.type==="paren" && t.value==="("));

  for (let i=0;i<tokens.length;i++){
    const cur = tokens[i];
    const prev = out[out.length-1];
    if (canLeft(prev) && canRight(cur)){
      // don't insert between fn and "(" (sin( ... )
      if (!(prev?.type==="fn" && cur.type==="paren" && cur.value==="(")){
        out.push({type:"op", value:"*"});
      }
    }
    out.push(cur);
  }
  return out;
}

// ---------- Shunting-yard to RPN ----------
const OP = {
  "+": {prec: 1, assoc: "L", arity:2},
  "-": {prec: 1, assoc: "L", arity:2},
  "*": {prec: 2, assoc: "L", arity:2},
  "/": {prec: 2, assoc: "L", arity:2},
  "%": {prec: 2, assoc: "L", arity:2}, // treat a % b = a*(b/100)?? We'll implement as remainder? Better: percent operator in calculator often means a*(b/100) or x% = x/100.
  "^": {prec: 4, assoc: "R", arity:2},
  "u-": {prec: 3, assoc: "R", arity:1},
};

function toRPN(tokens){
  const output = [];
  const stack = [];

  for (let i=0;i<tokens.length;i++){
    const t = tokens[i];

    if (t.type === "num" || t.type === "const"){
      output.push(t);
      continue;
    }

    if (t.type === "fn"){
      // postfix factorial (fact) support: represent as fn with special flag postfix
      output.push({type:"fn_marker", value:t.value}); // marker; will be handled when encountering "("? Actually factorial is postfix, no parentheses required.
      // We'll push as function token to stack for prefix fns (sin...) but factorial we handle as postfix token immediately.
      // Simpler: treat factorial as special fn in output if token is "fact" marker.
      continue;
    }

    if (t.type === "op"){
      while (stack.length){
        const top = stack[stack.length-1];
        if (top.type === "op"){
          const a = OP[t.value];
          const b = OP[top.value];
          if (!a || !b) break;

          if ((a.assoc === "L" && a.prec <= b.prec) || (a.assoc === "R" && a.prec < b.prec)){
            output.push(stack.pop());
            continue;
          }
        }
        break;
      }
      stack.push(t);
      continue;
    }

    if (t.type === "paren" && t.value === "("){
      // if previous token is a function name in raw string, we'd have tokenized as fn already.
      stack.push(t);
      continue;
    }

    if (t.type === "paren" && t.value === ")"){
      while (stack.length && !(stack[stack.length-1].type==="paren" && stack[stack.length-1].value==="(")){
        output.push(stack.pop());
      }
      if (!stack.length) throw new Error("Mismatched parentheses");
      stack.pop(); // pop "("

      // If there's a function on top of stack, pop it into output (prefix functions)
      // NOTE: In our tokenizer, functions are tokens, but we pushed them as fn_marker (immediate). Let's fix:
      // We'll instead encode functions in expression string as "sin(" etc using UI; tokenization returns fn tokens.
      // So we need to handle fn tokens properly: when fn appears, it should go onto stack, and after ")" it is popped.
      // We'll implement that by re-tokenizing functions as 'fn' and pushing to stack when encountered.
      continue;
    }
  }

  while (stack.length){
    const t = stack.pop();
    if (t.type === "paren") throw new Error("Mismatched parentheses");
    output.push(t);
  }

  return output;
}

// The above toRPN doesn't handle fn tokens properly as written. We'll implement a correct version:
function toRPN2(tokens){
  const output = [];
  const stack = [];

  for (let i=0;i<tokens.length;i++){
    const t = tokens[i];

    if (t.type === "num" || t.type === "const"){
      output.push(t);
      continue;
    }

    if (t.type === "fn"){
      if (t.value === "fact"){
        // postfix factorial
        output.push({type:"fn", value:"fact", postfix:true});
      } else {
        // prefix
        stack.push(t);
      }
      continue;
    }

    if (t.type === "op"){
      while (stack.length){
        const top = stack[stack.length-1];
        if (top.type === "op"){
          const a = OP[t.value];
          const b = OP[top.value];
          if (!a || !b) break;
          if ((a.assoc === "L" && a.prec <= b.prec) || (a.assoc === "R" && a.prec < b.prec)){
            output.push(stack.pop());
            continue;
          }
        } else if (top.type === "fn"){
          // functions have higher precedence than operators
          output.push(stack.pop());
          continue;
        }
        break;
      }
      stack.push(t);
      continue;
    }

    if (t.type === "paren" && t.value === "("){
      stack.push(t);
      continue;
    }

    if (t.type === "paren" && t.value === ")"){
      while (stack.length && !(stack[stack.length-1].type==="paren" && stack[stack.length-1].value==="(")){
        output.push(stack.pop());
      }
      if (!stack.length) throw new Error("Mismatched parentheses");
      stack.pop(); // remove "("

      // if function at top, pop it
      if (stack.length && stack[stack.length-1].type === "fn"){
        output.push(stack.pop());
      }
      continue;
    }

    throw new Error("Unexpected token");
  }

  while (stack.length){
    const t = stack.pop();
    if (t.type === "paren") throw new Error("Mismatched parentheses");
    output.push(t);
  }

  return output;
}

// ---------- RPN Evaluate ----------
function evalRPN(rpn){
  const st = [];
  for (const t of rpn){
    if (t.type === "num"){
      st.push(t.value);
      continue;
    }
    if (t.type === "const"){
      if (t.value === "pi") st.push(Math.PI);
      else if (t.value === "e") st.push(Math.E);
      else if (t.value === "ans") st.push(state.ans);
      continue;
    }
    if (t.type === "op"){
      const info = OP[t.value];
      if (!info) throw new Error("Unknown op");
      if (st.length < info.arity) throw new Error("Bad expression");

      if (t.value === "u-"){
        const a = st.pop();
        st.push(-a);
        continue;
      }

      const b = st.pop();
      const a = st.pop();

      if (t.value === "+") st.push(a + b);
      else if (t.value === "-") st.push(a - b);
      else if (t.value === "*") st.push(a * b);
      else if (t.value === "/") st.push(a / b);
      else if (t.value === "^") st.push(Math.pow(a, b));
      else if (t.value === "%"){
        // Percent behavior (calculator-like):
        // a % b -> a * (b/100)
        // If user types "x%" alone, they should use key "%" on a number then "="; we will interpret as (x/100) when missing left operand via UI using smart insert.
        st.push(a * (b / 100));
      }
      continue;
    }
    if (t.type === "fn"){
      if (st.length < 1) throw new Error("Bad function");
      const a = st.pop();

      const mode = state.mode;
      const trigIn = (x)=> mode==="DEG" ? degToRad(x) : x;
      const trigOut = (x)=> mode==="DEG" ? radToDeg(x) : x;

      let v;
      switch (t.value){
        case "sin": v = Math.sin(trigIn(a)); break;
        case "cos": v = Math.cos(trigIn(a)); break;
        case "tan": v = Math.tan(trigIn(a)); break;

        case "asin": v = trigOut(Math.asin(a)); break;
        case "acos": v = trigOut(Math.acos(a)); break;
        case "atan": v = trigOut(Math.atan(a)); break;

        case "log": v = Math.log10(a); break;
        case "ln": v = Math.log(a); break;
        case "sqrt": v = Math.sqrt(a); break;
        case "inv": v = 1 / a; break;
        case "fact": v = factorial(a); break;
        default: throw new Error("Unknown function: " + t.value);
      }
      st.push(v);
      continue;
    }
    throw new Error("Unknown token type");
  }
  if (st.length !== 1) throw new Error("Bad expression");
  return st[0];
}

function evaluateExpression(raw){
  const tokens = tokenize(raw);
  const rpn = toRPN2(tokens);
  return evalRPN(rpn);
}

// ---------- Expression builder ----------
function append(text){
  setExpr(state.expr + text);
  preview();
}

function smartAppendPercent(){
  // If ends with number/const/")" then append "%<number>"? That’s ambiguous.
  // We'll implement typical: when user presses %, append "%100" if pattern "a%" expected.
  // Better: If last token is number/const/")", we interpret "x%" as x%100 -> x*(100/100)=x (not good).
  // We'll do: if expression ends with number/const/")", append " % 1"??? Not.
  // Simpler: make "%" act as " /100" when at end; if inside a% b it works as a*(b/100).
  // So pressing "%" inserts "/100" if at end; else inserts "%" operator.
  const trimmed = state.expr.trim();
  if (!trimmed) return;
  const last = trimmed[trimmed.length-1];
  if (isDigit(last) || last===")" || last==="e" || last==="π" || last==="s"){ // rough
    append("/100");
    setHint("แทรก /100 (เปอร์เซ็นต์แบบ x% = x/100)");
  } else {
    append("%");
  }
}

function toggleParen(){
  const s = state.expr;
  // simple paren toggle: if open parens > close parens and last isn't "(" or operator => add ")"
  const opens = (s.match(/\(/g)||[]).length;
  const closes = (s.match(/\)/g)||[]).length;
  const last = s.trim().slice(-1);

  if (opens > closes && last && !"()+-×÷^".includes(last) && last !== "("){
    append(")");
  } else {
    // implicit multiplication if needed: "2(" or ")("
    if (s && /[0-9)\]eπ]$/.test(s)) append("×(");
    else append("(");
  }
}

function applyFn(fn){
  // functions operate on the last "value" if possible; otherwise insert fn( )
  // We'll do: if expression ends with number/)/const -> wrap last term; else insert fn(
  const s = state.expr.trim();
  const wrap = tryWrapLastValue(fn);
  if (!wrap){
    // insert like fn(
    const label = fnLabel(fn);
    if (s && /[0-9)\]eπ]$/.test(s)) append("×" + label + "(");
    else append(label + "(");
  } else {
    setExpr(wrap);
    preview();
  }
}

function fnLabel(fn){
  // UI uses √ and xʸ and 1/x and x! keys that map to internal
  if (fn === "sqrt") return "sqrt";
  if (fn === "pow") return "^";
  if (fn === "inv") return "inv";
  if (fn === "fact") return "!"; // postfix
  if (fn === "log") return "log";
  if (fn === "ln") return "ln";
  if (fn === "sin") return state.second ? "asin" : "sin";
  if (fn === "cos") return state.second ? "acos" : "cos";
  if (fn === "tan") return state.second ? "atan" : "tan";
  return fn;
}

function tryWrapLastValue(fn){
  const s = state.expr;
  if (!s) return null;

  // Find last "atom": number, constant, parenthesized group
  // We'll scan from end and extract:
  let i = s.length - 1;

  // skip spaces
  while (i>=0 && s[i] === " ") i--;
  if (i < 0) return null;

  // if ends with "!" we don't wrap further
  if (s[i] === "!") return null;

  // if ends with ")" find matching "("
  let start = -1;
  if (s[i] === ")"){
    let depth = 0;
    for (let j=i; j>=0; j--){
      if (s[j] === ")") depth++;
      else if (s[j] === "("){
        depth--;
        if (depth === 0){
          start = j;
          break;
        }
      }
    }
    if (start === -1) return null;
    const atom = s.slice(start, i+1);

    if (fn === "fact"){
      return s.slice(0, i+1) + "!" + s.slice(i+1);
    }
    if (fn === "pow"){
      return s.slice(0, i+1) + "^";
    }
    if (fn === "inv"){
      return s.slice(0, start) + "inv" + atom + s.slice(i+1);
    }
    const label = fnLabel(fn);
    return s.slice(0, start) + label + atom + s.slice(i+1);
  }

  // number/constant tail
  // collect token chars [0-9.] or letters for constants
  let j = i;
  while (j>=0 && /[0-9.]/.test(s[j])) j--;
  if (j !== i){
    const atom = s.slice(j+1, i+1);
    if (fn === "fact") return s.slice(0, i+1) + "!" + s.slice(i+1);
    if (fn === "pow") return s.slice(0, i+1) + "^";
    if (fn === "inv") return s.slice(0, j+1) + "inv(" + atom + ")" + s.slice(i+1);
    const label = fnLabel(fn);
    return s.slice(0, j+1) + label + "(" + atom + ")" + s.slice(i+1);
  }

  // constants π, e, Ans
  const consts = ["π","e","Ans"];
  for (const c of consts){
    if (s.endsWith(c)){
      const head = s.slice(0, s.length - c.length);
      if (fn === "fact") return s + "!";
      if (fn === "pow") return s + "^";
      if (fn === "inv") return head + "inv(" + c + ")";
      const label = fnLabel(fn);
      return head + label + "(" + c + ")";
    }
  }

  return null;
}

function del(){
  if (!state.expr) return;
  setExpr(state.expr.slice(0, -1));
  preview();
}

function ac(){
  setExpr("");
  setResult("0");
  setHint("ล้างแล้ว");
}

function toggleSign(){
  // If expression empty: start with "-"
  if (!state.expr){
    setExpr("-");
    preview();
    return;
  }

  // Try wrap last value with unary minus
  const s = state.expr;
  // If ends with ... ) or number/const => wrap last atom: -(atom)
  const wrapped = tryWrapLastValue("neg");
  if (wrapped){
    // implement neg manually
    const t = extractLastAtom(s);
    if (!t) return;
    const {start, end} = t;
    const atom = s.slice(start, end+1);
    setExpr(s.slice(0, start) + "-(" + atom + ")" + s.slice(end+1));
    preview();
    return;
  }
  // fallback: prepend -
  setExpr("-(" + s + ")");
  preview();
}

function extractLastAtom(s){
  let i = s.length-1;
  while (i>=0 && s[i]===" ") i--;
  if (i<0) return null;

  if (s[i] === ")"){
    let depth = 0;
    for (let j=i; j>=0; j--){
      if (s[j] === ")") depth++;
      else if (s[j] === "("){
        depth--;
        if (depth===0) return {start:j, end:i};
      }
    }
    return null;
  }

  // number tail
  let j=i;
  while (j>=0 && /[0-9.]/.test(s[j])) j--;
  if (j!==i) return {start:j+1, end:i};

  // constants
  if (s.endsWith("Ans")) return {start:s.length-3, end:s.length-1};
  if (s.endsWith("π")) return {start:s.length-1, end:s.length-1};
  if (s.endsWith("e")) return {start:s.length-1, end:s.length-1};

  return null;
}

function eq(){
  if (!state.expr.trim()){
    setResult("0");
    return;
  }
  try{
    const val = evaluateExpression(state.expr);
    const out = formatNumber(val);

    if (out !== "Error"){
      state.ans = val;
      ansPill.textContent = `Ans: ${formatNumber(state.ans)}`;
      addHistory(state.expr, out);
    }
    setResult(out);
    setHint(out === "Error" ? "นิพจน์ไม่ถูกต้อง" : "คำนวณแล้ว");
  } catch (e){
    setResult("Error");
    setHint("นิพจน์ไม่ถูกต้อง");
  }
}

function preview(){
  // live preview if expression seems evaluable
  const s = state.expr.trim();
  if (!s){
    setResult("0");
    return;
  }
  // Avoid preview if ends with operator or "("
  const last = s[s.length-1];
  if ("+-×÷^%(".includes(last)) return;

  try{
    const val = evaluateExpression(s);
    const out = formatNumber(val);
    if (out !== "Error") setResult(out);
  } catch {
    // ignore preview errors
  }
}

// ---------- History ----------
function addHistory(expr, result){
  state.history.unshift({expr, result});
  if (state.history.length > 18) state.history.pop();
  renderHistory();
}

function renderHistory(){
  historyListEl.innerHTML = "";
  if (state.history.length === 0){
    const empty = document.createElement("div");
    empty.className = "hitem";
    empty.innerHTML = `<div class="hExpr">ยังไม่มีประวัติ</div><div class="hRes">เริ่มคำนวณได้เลย</div>`;
    empty.style.opacity = ".7";
    historyListEl.appendChild(empty);
    return;
  }
  for (const h of state.history){
    const item = document.createElement("div");
    item.className = "hitem";
    item.innerHTML = `<div class="hExpr">${escapeHtml(h.expr)}</div><div class="hRes">${escapeHtml(h.result)}</div>`;
    item.addEventListener("click", ()=>{
      setExpr(h.expr);
      preview();
      setHint("ดึงจาก History แล้ว");
    });
    historyListEl.appendChild(item);
  }
}

function escapeHtml(s){
  return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

// ---------- Mode toggles ----------
function setMode(m){
  state.mode = m;
  const isDeg = m === "DEG";
  btnDeg.classList.toggle("active", isDeg);
  btnRad.classList.toggle("active", !isDeg);
  btnDeg.setAttribute("aria-pressed", String(isDeg));
  btnRad.setAttribute("aria-pressed", String(!isDeg));
  modePill.textContent = m;
  setHint(`โหมด ${m}`);
  preview();
}

function setSecond(on){
  state.second = on;
  btn2nd.classList.toggle("active", on);
  btn2nd.setAttribute("aria-pressed", String(on));
  secondPill.textContent = `2nd: ${on ? "ON" : "OFF"}`;
  // update labels on trig keys
  document.querySelectorAll('[data-fn="sin"]').forEach(b=> b.textContent = on ? "asin" : "sin");
  document.querySelectorAll('[data-fn="cos"]').forEach(b=> b.textContent = on ? "acos" : "cos");
  document.querySelectorAll('[data-fn="tan"]').forEach(b=> b.textContent = on ? "atan" : "tan");
  setHint(on ? "2nd เปิด: trig กลายเป็น inverse" : "2nd ปิด");
}

// ---------- Button handling ----------
document.querySelector(".pad").addEventListener("click", (ev)=>{
  const btn = ev.target.closest("button");
  if (!btn) return;

  const insert = btn.getAttribute("data-insert");
  const action = btn.getAttribute("data-action");
  const fn = btn.getAttribute("data-fn");

  if (insert != null){
    if (insert === "%") {
      smartAppendPercent();
      return;
    }
    // Convert UI friendly operators into expr symbols
    if (insert === "÷") append("÷");
    else if (insert === "×") append("×");
    else if (insert === ")") append(")");
    else append(insert);
    return;
  }

  if (fn){
    // map trig to inverse if 2nd
    if (fn === "sin") applyFn(state.second ? "asin" : "sin");
    else if (fn === "cos") applyFn(state.second ? "acos" : "cos");
    else if (fn === "tan") applyFn(state.second ? "atan" : "tan");
    else if (fn === "sqrt") applyFn("sqrt");
    else if (fn === "log") applyFn("log");
    else if (fn === "ln") applyFn("ln");
    else if (fn === "inv") applyFn("inv");
    else if (fn === "fact") applyFn("fact");
    else if (fn === "pow") applyFn("pow");
    return;
  }

  if (action){
    switch (action){
      case "ac": ac(); break;
      case "del": del(); break;
      case "eq": eq(); break;
      case "paren": toggleParen(); break;
      case "ans":
        if (state.expr && /[0-9)\]eπ]$/.test(state.expr.trim())) append("×Ans");
        else append("Ans");
        break;
      case "sign": toggleSign(); break;
      case "mc":
        state.ans = 0;
        ansPill.textContent = `Ans: 0`;
        setHint("ล้าง Ans แล้ว");
        preview();
        break;
      default:
        break;
    }
  }
});

// top toggles
btnDeg.addEventListener("click", ()=> setMode("DEG"));
btnRad.addEventListener("click", ()=> setMode("RAD"));
btn2nd.addEventListener("click", ()=> setSecond(!state.second));
btnClearHistory.addEventListener("click", ()=>{
  state.history = [];
  renderHistory();
  setHint("ล้าง History แล้ว");
});

// ---------- Keyboard support ----------
window.addEventListener("keydown", (e)=>{
  // prevent scrolling on space
  if (e.key === " "){ e.preventDefault(); }

  // Enter => =
  if (e.key === "Enter"){
    e.preventDefault();
    eq();
    return;
  }
  // Backspace => DEL
  if (e.key === "Backspace"){
    e.preventDefault();
    del();
    return;
  }
  // Escape => AC
  if (e.key === "Escape"){
    e.preventDefault();
    ac();
    return;
  }

  // parentheses
  if (e.key === "(" || e.key === ")"){ append(e.key); return; }

  // numbers & dot
  if ((e.key >= "0" && e.key <= "9") || e.key === "."){
    append(e.key);
    return;
  }

  // operators
  if (e.key === "+" || e.key === "-" || e.key === "*" || e.key === "/" || e.key === "^"){
    const map = { "*":"×", "/":"÷" };
    append(map[e.key] || e.key);
    return;
  }

  // percent (keyboard %)
  if (e.key === "%"){
    smartAppendPercent();
    return;
  }

  // quick constants
  if (e.key.toLowerCase() === "p"){ // p = pi
    if (state.expr && /[0-9)\]eπ]$/.test(state.expr.trim())) append("×π");
    else append("π");
    return;
  }
  if (e.key.toLowerCase() === "a"){ // a = Ans
    if (state.expr && /[0-9)\]eπ]$/.test(state.expr.trim())) append("×Ans");
    else append("Ans");
    return;
  }

  // quick functions (type letters then "(" yourself)
  // s = sin, c = cos, t = tan, l = ln, g = log, r = sqrt
  if (e.key.toLowerCase() === "r"){ // sqrt(
    applyFn("sqrt"); return;
  }
});

// ---------- Init ----------
setMode("DEG");
setSecond(false);
renderHistory();
setExpr("");
setResult("0");
ansPill.textContent = `Ans: 0`;
setHint("พร้อมใช้งาน");
