"use client";
import { useState, useCallback, useEffect } from "react";

// ─── ユーティリティ ───────────────────────────────────────────────
function formatYen(n) {
  if (!n && n !== 0) return "—";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function calcShiftResult(s) {
  let hourPay = 0;
  if (s.startTime && s.endTime && s.hourlyRate) {
    const [sh, sm] = s.startTime.split(":").map(Number);
    let [eh, em] = s.endTime.split(":").map(Number);
    let start = sh * 60 + sm, end = eh * 60 + em;
    if (end <= start) end += 24 * 60;
    hourPay = ((end - start) / 60) * Number(s.hourlyRate);
  }
  const back = (Number(s.sales) || 0) * ((Number(s.backRate) || 0) / 100);
  const shimei = (Number(s.shimeiCount) || 0) * (Number(s.shimeiRate) || 0);
  const honShimei = (Number(s.honShimeiCount) || 0) * (Number(s.honShimeiRate) || 0);
  const bonus = Number(s.bonus) || 0;
  const transport = Number(s.transport) || 0;
  const deductions = (Number(s.latePenalty) || 0) + (Number(s.costumeCut) || 0) + (Number(s.otherDeduction) || 0);
  const gross = hourPay + back + shimei + honShimei + bonus + transport;
  const net = gross - deductions;
  return { hourPay, back, shimei, honShimei, bonus, transport, deductions, gross, net };
}

function calcTax({ annualIncome, employmentIncome, isSideJob }) {
  const total = annualIncome + (isSideJob ? employmentIncome : 0);
  const basicDeduction = total <= 24000000 ? 480000 : 0;
  let employDeduction = 0;
  if (isSideJob && employmentIncome > 0) {
    if (employmentIncome <= 1625000) employDeduction = 550000;
    else if (employmentIncome <= 1800000) employDeduction = employmentIncome * 0.4 - 100000;
    else if (employmentIncome <= 3600000) employDeduction = employmentIncome * 0.3 + 80000;
    else if (employmentIncome <= 6600000) employDeduction = employmentIncome * 0.2 + 440000;
    else if (employmentIncome <= 8500000) employDeduction = employmentIncome * 0.1 + 1100000;
    else employDeduction = 1950000;
  }
  const businessDeduction = !isSideJob ? 650000 : 0;
  const taxableIncome = Math.max(0, total - basicDeduction - employDeduction - businessDeduction);
  let incomeTax = 0;
  for (const [limit, rate, deduct] of [
    [1950000,0.05,0],[3300000,0.1,97500],[6950000,0.2,427500],
    [9000000,0.23,636000],[18000000,0.33,1536000],[40000000,0.4,2796000],[Infinity,0.45,4796000]
  ]) { if (taxableIncome <= limit) { incomeTax = taxableIncome * rate - deduct; break; } }
  incomeTax = Math.max(0, incomeTax) * 1.021;
  const residentTax = taxableIncome * 0.1;
  const socialInsurance = !isSideJob ? annualIncome * 0.12 : 0;
  const totalTax = incomeTax + residentTax + socialInsurance;
  return { taxableIncome, incomeTax, residentTax, socialInsurance, totalTax, takeHome: annualIncome - totalTax, basicDeduction, employDeduction, businessDeduction };
}

const ACCOUNT_MAP = {
  hourPay:      { name: "時給収入",       category: "売上・収入",     type: "income" },
  back:         { name: "バック（歩合）", category: "売上・収入",     type: "income" },
  shimei:       { name: "指名料",         category: "売上・収入",     type: "income" },
  honShimei:    { name: "本指名料",       category: "売上・収入",     type: "income" },
  bonus:        { name: "賞与・インセンティブ", category: "売上・収入", type: "income" },
  transport:    { name: "交通費（支給）", category: "経費（旅費交通費）", type: "expense" },
  latePenalty:  { name: "罰金・遅刻控除", category: "その他控除",    type: "deduction" },
  costumeCut:   { name: "衣装代控除",     category: "経費（衣装費）", type: "expense" },
  otherDeduction:{ name:"その他控除",     category: "その他控除",    type: "deduction" },
};

const STORAGE_KEY = "nightwork_shifts_v3";
const PREM_KEY    = "nightwork_premium_v2";
const PLAN_KEY    = "nightwork_plan";

function loadShifts() { try { const d = localStorage.getItem(STORAGE_KEY); return d ? JSON.parse(d) : null; } catch { return null; } }
function saveShifts(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} }
function loadPremium() { try { return localStorage.getItem(PREM_KEY) === "true"; } catch { return false; } }
function savePremium(v) { try { localStorage.setItem(PREM_KEY, String(v)); } catch {} }
function loadPlan() { try { return localStorage.getItem(PLAN_KEY) || "monthly"; } catch { return "monthly"; } }
function savePlan(v) { try { localStorage.setItem(PLAN_KEY, v); } catch {} }

function newShift() {
  return { id: Date.now() + Math.random(), date: "", startTime: "", endTime: "", hourlyRate: "",
    backRate: "", sales: "", shimeiCount: "", shimeiRate: "", honShimeiCount: "", honShimeiRate: "",
    bonus: "", transport: "", latePenalty: "", costumeCut: "", otherDeduction: "" };
}

function generatePrintHTML(shifts, totals, taxResult, isPremium, isSideJob, period) {
  const rows = shifts.map(s => {
    const c = calcShiftResult(s);
    return `<tr><td>${s.date||"—"}</td><td>${s.startTime||"—"}〜${s.endTime||"—"}</td>
      <td style="text-align:right">${formatYen(c.hourPay)}</td>
      <td style="text-align:right">${formatYen(c.back)}</td>
      <td style="text-align:right">${formatYen(c.shimei+c.honShimei)}</td>
      <td style="text-align:right">${formatYen(c.deductions)}</td>
      <td style="text-align:right;font-weight:bold;color:#1a6640">${formatYen(c.net)}</td></tr>`;
  }).join("");
  const taxSection = isPremium && taxResult ? `
    <div class="section"><h2>税金シミュレーション（${isSideJob?"副業合算":"フリーランス"}）</h2>
    <table>
      <tr><td>課税所得</td><td style="text-align:right">${formatYen(taxResult.taxableIncome)}</td></tr>
      <tr><td>所得税（復興税込）</td><td style="text-align:right;color:#c0392b">${formatYen(taxResult.incomeTax)}</td></tr>
      <tr><td>住民税（概算）</td><td style="text-align:right;color:#c0392b">${formatYen(taxResult.residentTax)}</td></tr>
      ${!isSideJob?`<tr><td>国民健康保険（概算）</td><td style="text-align:right;color:#c0392b">${formatYen(taxResult.socialInsurance)}</td></tr>`:""}
      <tr style="font-weight:bold"><td>税・保険料合計</td><td style="text-align:right;color:#c0392b">${formatYen(taxResult.totalTax)}</td></tr>
      <tr style="font-weight:bold;background:#e8f5e9"><td>税引後手取り（年間推計）</td><td style="text-align:right;color:#1a6640">${formatYen(taxResult.takeHome)}</td></tr>
    </table></div>` : "";
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>給与明細書</title>
  <style>body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#222;margin:32px}
  h1{font-size:20px;margin-bottom:4px}h2{font-size:13px;border-bottom:2px solid #1a1a2e;padding-bottom:4px;margin:16px 0 8px}
  table{width:100%;border-collapse:collapse}.section{margin-bottom:20px}
  th,td{border:1px solid #ddd;padding:6px 10px;font-size:11px}th{background:#1a1a2e;color:#fff;text-align:left}
  .total-row{background:#f5f5f5;font-weight:bold}.meta{color:#666;font-size:11px;margin-bottom:20px}</style>
  </head><body>
  <h1>💼 給与明細書</h1>
  <div class="meta">集計期間：${period} ／ シフト数：${shifts.length}回 ／ 出力日：${new Date().toLocaleDateString("ja-JP")}</div>
  <div class="section"><h2>シフト別明細</h2>
  <table><thead><tr><th>日付</th><th>時間</th><th>時給分</th><th>バック</th><th>指名計</th><th>控除</th><th>手取り</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row"><td colspan="2">合計</td>
    <td style="text-align:right">${formatYen(totals.hourPay)}</td>
    <td style="text-align:right">${formatYen(totals.back)}</td>
    <td style="text-align:right">${formatYen(totals.shimei)}</td>
    <td style="text-align:right">-${formatYen(totals.deductions)}</td>
    <td style="text-align:right;color:#1a6640">${formatYen(totals.net)}</td>
  </tr></tfoot></table></div>
  ${taxSection}
  <div style="font-size:10px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:8px">
  ※税金計算は概算です。正確な申告は税理士または税務署にご相談ください。</div>
  </body></html>`;
}

// ─── カレンダーコンポーネント ──────────────────────────────────────
function ShiftCalendar({ shifts, calYear, calMonth, onMonthChange, onDayClick }) {
  const shiftDates = new Set(shifts.map(s => s.date).filter(Boolean));
  const shiftByDate = {};
  shifts.forEach(s => { if (s.date) { const c = calcShiftResult(s); shiftByDate[s.date] = (shiftByDate[s.date] || 0) + c.net; } });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const WEEKDAYS = ["日","月","火","水","木","金","土"];

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="cal-wrap">
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => onMonthChange(-1)}>‹</button>
        <span className="cal-month-lbl">{calYear}年 {calMonth+1}月</span>
        <button className="cal-nav-btn" onClick={() => onMonthChange(1)}>›</button>
      </div>
      <div className="cal-grid-head">
        {WEEKDAYS.map((w,i) => <div key={w} className={`cal-wday${i===0?" sun":i===6?" sat":""}`}>{w}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="cal-cell empty" />;
          const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const hasShift = shiftDates.has(dateStr);
          const net = shiftByDate[dateStr];
          const isToday = dateStr === todayStr;
          const dow = (firstDay + d - 1) % 7;
          return (
            <div key={d} className={`cal-cell${hasShift?" worked":""}${isToday?" today":""}`}
              onClick={() => onDayClick(dateStr)}>
              <span className={`cal-day${dow===0?" sun":dow===6?" sat":""}`}>{d}</span>
              {hasShift && <span className="cal-dot" />}
              {hasShift && net > 0 && <span className="cal-earn">{Math.round(net/1000)}k</span>}
            </div>
          );
        })}
      </div>
      <div className="cal-legend">
        <span className="cal-legend-dot" />出勤日
        <span style={{marginLeft:12,color:"var(--muted)",fontSize:".65rem"}}>タップでシフト追加</span>
      </div>
    </div>
  );
}

// ─── シフト行 ─────────────────────────────────────────────────────
function ShiftRow({ shift, onChange, onDelete }) {
  const calc = calcShiftResult(shift);
  const [open, setOpen] = useState(!shift.startTime);
  const f = (name, ph) => (
    <input type="number" placeholder={ph} value={shift[name]} min="0"
      onChange={e => onChange(shift.id, name, e.target.value)} className="inp" />
  );
  return (
    <div className="shift-card">
      <div className="shift-header" onClick={() => setOpen(o => !o)} style={{cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span className="shift-date-badge">{shift.date || "日付未設定"}</span>
          {shift.startTime && <span style={{fontSize:".72rem",color:"var(--muted)"}}>{shift.startTime}〜{shift.endTime}</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {!open && <span className="shift-net-preview">{formatYen(calc.net)}</span>}
          <span style={{color:"var(--muted)",fontSize:".8rem"}}>{open?"▲":"▼"}</span>
          <button className="del-btn" onClick={e=>{e.stopPropagation();onDelete(shift.id)}}>✕</button>
        </div>
      </div>

      {open && <>
        <div className="sec-label">⏰ 勤務時間・時給</div>
        <div className="g3">
          <label className="fw"><span>出勤</span><input type="time" value={shift.startTime} onChange={e=>onChange(shift.id,"startTime",e.target.value)} className="inp"/></label>
          <label className="fw"><span>退勤</span><input type="time" value={shift.endTime} onChange={e=>onChange(shift.id,"endTime",e.target.value)} className="inp"/></label>
          <label className="fw"><span>時給 (¥)</span>{f("hourlyRate","3000")}</label>
        </div>
        <div className="sec-label">💴 バック・売上</div>
        <div className="g2">
          <label className="fw"><span>売上 (¥)</span>{f("sales","0")}</label>
          <label className="fw"><span>バック率 (%)</span>{f("backRate","10")}</label>
        </div>
        <div className="sec-label">💎 指名</div>
        <div className="g2">
          <label className="fw"><span>指名 件数</span>{f("shimeiCount","0")}</label>
          <label className="fw"><span>指名単価 (¥)</span>{f("shimeiRate","1000")}</label>
          <label className="fw"><span>本指名 件数</span>{f("honShimeiCount","0")}</label>
          <label className="fw"><span>本指名単価 (¥)</span>{f("honShimeiRate","2000")}</label>
        </div>
        <div className="sec-label">➕ 加算</div>
        <div className="g2">
          <label className="fw"><span>ボーナス (¥)</span>{f("bonus","0")}</label>
          <label className="fw"><span>交通費 (¥)</span>{f("transport","0")}</label>
        </div>
        <div className="sec-label">➖ 控除</div>
        <div className="g3">
          <label className="fw"><span>罰金・遅刻 (¥)</span>{f("latePenalty","0")}</label>
          <label className="fw"><span>衣装代 (¥)</span>{f("costumeCut","0")}</label>
          <label className="fw"><span>その他控除 (¥)</span>{f("otherDeduction","0")}</label>
        </div>
        <div className="result-bar">
          {[["時給分",calc.hourPay],["バック",calc.back],["指名計",calc.shimei+calc.honShimei]].map(([l,v])=>(
            <div className="ri" key={l}><span className="rl">{l}</span><span className="rv">{formatYen(v)}</span></div>
          ))}
          <div className="ri"><span className="rl">控除</span><span className="rv neg">-{formatYen(calc.deductions)}</span></div>
          <div className="ri net"><span className="rl">手取り</span><span className="rv net-v">{formatYen(calc.net)}</span></div>
        </div>
      </>}
    </div>
  );
}

// ─── メインアプリ ─────────────────────────────────────────────────
export default function App() {
  const [isPremium, setIsPremium] = useState(() => loadPremium());
  const [plan, setPlan] = useState(() => loadPlan());
  const [shifts, setShifts] = useState(() => loadShifts() || [newShift()]);
  const [period, setPeriod] = useState("月次");
  const [tab, setTab] = useState("shifts");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradePlan, setUpgradePlan] = useState("monthly");
  const [isSideJob, setIsSideJob] = useState(false);
  const [employmentIncome, setEmploymentIncome] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  useEffect(() => { if (isPremium) saveShifts(shifts); }, [shifts, isPremium]);

  const addShift = (date = "") => setShifts(p => [...p, { ...newShift(), id: Date.now() + Math.random(), date }]);
  const deleteShift = id => setShifts(p => p.filter(s => s.id !== id));
  const updateShift = useCallback((id, name, value) => {
    setShifts(p => p.map(s => s.id === id ? { ...s, [name]: value } : s));
  }, []);

  const handleDayClick = (dateStr) => {
    const exists = shifts.find(s => s.date === dateStr);
    if (!exists) addShift(dateStr);
    else {
      const el = document.getElementById(`shift-${exists.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const handleMonthChange = (delta) => {
    let m = calMonth + delta, y = calYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCalYear(y); setCalMonth(m);
  };

  const totals = shifts.reduce((acc, s) => {
    const c = calcShiftResult(s);
    return { hourPay: acc.hourPay+c.hourPay, back: acc.back+c.back, shimei: acc.shimei+c.shimei+c.honShimei,
      deductions: acc.deductions+c.deductions, gross: acc.gross+c.gross, net: acc.net+c.net };
  }, { hourPay:0, back:0, shimei:0, deductions:0, gross:0, net:0 });

  const annualFactor = period === "月次" ? 12 : period === "週次" ? 52 : 36;
  const annualIncome = totals.net * annualFactor;
  const taxResult = calcTax({ annualIncome, employmentIncome: Number(employmentIncome)||0, isSideJob });

  const ledgerRows = [];
  shifts.forEach((s, i) => {
    const c = calcShiftResult(s);
    Object.entries(ACCOUNT_MAP).forEach(([key, info]) => {
      const val = key === "shimei" ? c.shimei+c.honShimei : c[key];
      if (val) ledgerRows.push({ date: s.date || `シフト${i+1}`, ...info, amount: val });
    });
  });

  const handleActivatePremium = (selectedPlan) => {
    setIsPremium(true); savePremium(true);
    setPlan(selectedPlan); savePlan(selectedPlan);
    setShowUpgrade(false); setTab("tax");
  };

  const handleSave = () => { saveShifts(shifts); setSavedMsg("保存しました ✓"); setTimeout(()=>setSavedMsg(""),2000); };
  const handlePrint = () => {
    const html = generatePrintHTML(shifts, totals, isPremium ? taxResult : null, isPremium, isSideJob, period);
    const win = window.open("","_blank"); win.document.write(html); win.document.close();
    setTimeout(()=>{ win.print(); }, 400);
  };

  const premiumTabs = ["tax","ledger","export"];
  const handleTabClick = (t) => { if (premiumTabs.includes(t) && !isPremium) { setShowUpgrade(true); return; } setTab(t); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&family=Cormorant+Garamond:ital,wght@1,700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{
          --bg:#080610;--surf:#110d1e;--card:#1a1330;--bdr:#2a1f44;
          --acc:#d4488e;--acc2:#8b5cf6;--gold:#f4c066;--grn:#3dd68c;
          --red:#f06878;--txt:#ede9ff;--muted:#7c6fa0;--radius:14px;
        }
        body{background:var(--bg);color:var(--txt);font-family:'Noto Sans JP',sans-serif;min-height:100vh}
        .app{max-width:680px;margin:0 auto;padding:20px 14px 100px}

        .hdr{text-align:center;margin-bottom:24px}
        .hdr-title{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:2.2rem;
          background:linear-gradient(135deg,var(--acc),var(--acc2));-webkit-background-clip:text;
          -webkit-text-fill-color:transparent;background-clip:text}
        .hdr-sub{font-size:.68rem;letter-spacing:.15em;color:var(--muted);margin-top:2px}
        .prem-badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,var(--gold),#e0963a);
          color:#1a0d00;font-size:.63rem;font-weight:900;padding:2px 10px;border-radius:20px;margin-top:6px;letter-spacing:.05em}
        .plan-badge{display:inline-flex;align-items:center;gap:4px;
          background:rgba(255,255,255,.07);color:var(--muted);
          font-size:.6rem;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:4px;margin-left:6px}

        .summary{background:linear-gradient(135deg,#1a0d30,#0d0820);border:1px solid var(--bdr);
          border-radius:var(--radius);padding:18px;margin-bottom:18px;position:relative;overflow:hidden}
        .summary::after{content:'';position:absolute;top:-50px;right:-50px;width:180px;height:180px;
          background:radial-gradient(circle,rgba(212,72,142,.15) 0%,transparent 70%);pointer-events:none}
        .sum-lbl{font-size:.63rem;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
        .sum-val{font-size:2.5rem;font-weight:900;color:var(--grn);letter-spacing:-.03em;line-height:1.1}
        .sum-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
        .si{background:rgba(255,255,255,.04);border-radius:10px;padding:9px 11px}
        .sil{font-size:.61rem;color:var(--muted);margin-bottom:2px}
        .siv{font-size:.9rem;font-weight:700}
        .siv.p{color:var(--acc2)}.siv.g{color:var(--gold)}.siv.r{color:var(--red)}

        /* ─ カレンダー ─ */
        .cal-wrap{background:var(--card);border:1px solid var(--bdr);border-radius:var(--radius);
          padding:14px;margin-bottom:16px}
        .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
        .cal-month-lbl{font-size:.9rem;font-weight:700;color:var(--txt)}
        .cal-nav-btn{background:rgba(255,255,255,.06);border:1px solid var(--bdr);color:var(--txt);
          border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:1.1rem;
          display:flex;align-items:center;justify-content:center;transition:background .15s}
        .cal-nav-btn:hover{background:rgba(139,92,246,.2)}
        .cal-grid-head{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}
        .cal-wday{text-align:center;font-size:.62rem;color:var(--muted);padding:3px 0}
        .cal-wday.sun{color:#f9918a}.cal-wday.sat{color:#7eb8f7}
        .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
        .cal-cell{aspect-ratio:1;border-radius:8px;display:flex;flex-direction:column;
          align-items:center;justify-content:center;cursor:pointer;position:relative;
          background:rgba(255,255,255,.03);transition:background .15s;overflow:hidden}
        .cal-cell:hover{background:rgba(139,92,246,.15)}
        .cal-cell.empty{cursor:default;background:transparent}
        .cal-cell.empty:hover{background:transparent}
        .cal-cell.worked{background:linear-gradient(135deg,rgba(212,72,142,.25),rgba(139,92,246,.25));
          border:1px solid rgba(212,72,142,.35)}
        .cal-cell.today .cal-day{background:var(--acc2);color:#fff;border-radius:50%;
          width:20px;height:20px;display:flex;align-items:center;justify-content:center}
        .cal-day{font-size:.72rem;font-weight:700;line-height:1}
        .cal-day.sun{color:#f9918a}.cal-day.sat{color:#7eb8f7}
        .cal-dot{width:4px;height:4px;border-radius:50%;background:var(--acc);margin-top:2px}
        .cal-earn{font-size:.52rem;color:var(--gold);font-weight:700;margin-top:1px;line-height:1}
        .cal-legend{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:.65rem;color:var(--muted)}
        .cal-legend-dot{width:8px;height:8px;border-radius:50%;background:var(--acc);display:inline-block}

        /* ─ タブ ─ */
        .tabs{display:flex;gap:3px;margin-bottom:16px;background:var(--surf);border-radius:12px;padding:4px}
        .tab{flex:1;padding:8px 4px;border-radius:9px;border:none;background:transparent;
          color:var(--muted);font-family:inherit;font-size:.72rem;cursor:pointer;transition:all .2s;
          display:flex;align-items:center;justify-content:center;gap:3px}
        .tab.active{background:linear-gradient(135deg,var(--acc2),var(--acc));color:#fff;font-weight:700}
        .tab.locked{opacity:.5}

        .ptabs{display:flex;gap:5px;justify-content:center;margin-bottom:14px}
        .ptab{padding:4px 14px;border-radius:20px;border:1px solid var(--bdr);background:transparent;
          color:var(--muted);font-family:inherit;font-size:.73rem;cursor:pointer;transition:all .15s}
        .ptab.active{background:linear-gradient(135deg,var(--acc2),var(--acc));border-color:transparent;color:#fff;font-weight:700}

        /* ─ シフトカード ─ */
        .shift-card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--radius);
          padding:13px;margin-bottom:10px;transition:border-color .2s}
        .shift-card:focus-within{border-color:var(--acc2)}
        .shift-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:0}
        .shift-date-badge{font-size:.82rem;font-weight:700;color:var(--acc);background:rgba(212,72,142,.1);
          padding:2px 10px;border-radius:20px}
        .shift-net-preview{font-size:.82rem;font-weight:700;color:var(--grn)}
        .del-btn{background:rgba(240,104,120,.12);border:1px solid rgba(240,104,120,.25);color:var(--red);
          border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:.72rem;display:flex;
          align-items:center;justify-content:center;transition:background .15s}
        .del-btn:hover{background:rgba(240,104,120,.28)}
        .sec-label{font-size:.62rem;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin:11px 0 6px}
        .g2{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
        .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
        .fw{display:flex;flex-direction:column;gap:3px}.fw span{font-size:.61rem;color:var(--muted)}
        .inp{background:rgba(255,255,255,.05);border:1px solid var(--bdr);border-radius:8px;
          color:var(--txt);font-family:inherit;font-size:.84rem;padding:7px 9px;width:100%;
          outline:none;transition:border-color .15s;-webkit-appearance:none;appearance:none}
        .inp:focus{border-color:var(--acc2);background:rgba(139,92,246,.08)}
        input[type=date]::-webkit-calendar-picker-indicator,
        input[type=time]::-webkit-calendar-picker-indicator{filter:invert(.5) sepia(1) saturate(3) hue-rotate(260deg);opacity:.6;cursor:pointer}
        .result-bar{background:rgba(255,255,255,.03);border:1px solid var(--bdr);border-radius:10px;
          padding:9px;margin-top:11px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
        .ri{display:flex;flex-direction:column;align-items:center;flex:1;min-width:52px}
        .ri.net{background:rgba(61,214,140,.08);border:1px solid rgba(61,214,140,.2);border-radius:8px;padding:5px 8px}
        .rl{font-size:.58rem;color:var(--muted)}.rv{font-size:.8rem;font-weight:700}
        .rv.neg{color:var(--red)}.rv.net-v{color:var(--grn);font-size:.92rem}

        .btn-add{width:100%;padding:12px;border-radius:var(--radius);border:2px dashed var(--bdr);
          background:transparent;color:var(--muted);font-family:inherit;font-size:.85rem;cursor:pointer;
          transition:all .2s;margin-bottom:8px}
        .btn-add:hover{border-color:var(--acc2);color:var(--acc2);background:rgba(139,92,246,.06)}

        /* ─ プレミアムパネル ─ */
        .panel{background:var(--card);border:1px solid var(--bdr);border-radius:var(--radius);padding:16px;margin-bottom:12px}
        .panel-title{font-size:.92rem;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px}
        .tax-row{display:flex;justify-content:space-between;align-items:center;padding:8px 11px;
          border-radius:8px;background:rgba(255,255,255,.03);margin-bottom:5px;font-size:.83rem}
        .tax-row.total{background:rgba(61,214,140,.08);border:1px solid rgba(61,214,140,.2)}
        .tax-row.deduct{background:rgba(240,104,120,.07)}
        .tax-lbl{color:var(--muted)}.tax-val{font-weight:700}
        .tax-val.r{color:var(--red)}.tax-val.g{color:var(--grn)}.tax-val.p{color:var(--acc2)}
        .toggle-wrap{display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer}
        .toggle{width:38px;height:22px;border-radius:11px;background:var(--bdr);position:relative;transition:background .2s;flex-shrink:0}
        .toggle.on{background:linear-gradient(135deg,var(--acc2),var(--acc))}
        .toggle::after{content:'';position:absolute;width:16px;height:16px;background:#fff;border-radius:50%;top:3px;left:3px;transition:left .2s}
        .toggle.on::after{left:19px}
        .toggle-lbl{font-size:.8rem}
        .ledger-table{width:100%;border-collapse:collapse;font-size:.76rem}
        .ledger-table th{text-align:left;color:var(--muted);font-weight:400;padding:5px 7px;border-bottom:1px solid var(--bdr);font-size:.63rem;letter-spacing:.06em;text-transform:uppercase}
        .ledger-table td{padding:6px 7px;border-bottom:1px solid rgba(255,255,255,.04)}
        .bdg{display:inline-block;font-size:.58rem;padding:2px 6px;border-radius:10px;font-weight:700}
        .bdg.income{background:rgba(61,214,140,.15);color:var(--grn)}
        .bdg.expense{background:rgba(244,192,102,.15);color:var(--gold)}
        .bdg.deduction{background:rgba(240,104,120,.15);color:var(--red)}
        .export-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
        .export-btn{padding:13px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,.04);
          color:var(--txt);font-family:inherit;font-size:.8rem;cursor:pointer;transition:all .2s;
          display:flex;flex-direction:column;align-items:center;gap:5px}
        .export-btn:hover{border-color:var(--acc2);background:rgba(139,92,246,.1)}
        .export-btn .icon{font-size:1.5rem}
        .save-msg{color:var(--grn);font-size:.73rem;text-align:center;margin-top:6px;height:18px}

        /* ─ アップグレードモーダル ─ */
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:100;
          display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(5px)}
        .modal{background:var(--surf);border:1px solid var(--bdr);border-radius:20px 20px 0 0;
          padding:26px 18px 32px;width:100%;max-width:480px;animation:slideUp .3s ease;max-height:90vh;overflow-y:auto}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .modal-title{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:1.7rem;
          background:linear-gradient(135deg,var(--gold),#e0963a);-webkit-background-clip:text;
          -webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
        .modal-sub{color:var(--muted);font-size:.78rem;margin-bottom:18px}
        .feat-list{list-style:none;margin-bottom:18px}
        .feat-list li{padding:7px 0;border-bottom:1px solid var(--bdr);font-size:.82rem;display:flex;align-items:center;gap:7px}
        .feat-list li::before{content:'✦';color:var(--gold);font-size:.68rem}

        /* プラン選択 */
        .plan-select{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
        .plan-card{border:2px solid var(--bdr);border-radius:12px;padding:14px;cursor:pointer;
          transition:all .2s;text-align:center;position:relative}
        .plan-card.selected{border-color:var(--acc);background:rgba(212,72,142,.1)}
        .plan-card-badge{position:absolute;top:-9px;left:50%;transform:translateX(-50%);
          background:linear-gradient(135deg,var(--gold),#e0963a);color:#1a0d00;
          font-size:.58rem;font-weight:900;padding:2px 8px;border-radius:10px;white-space:nowrap}
        .plan-name{font-size:.75rem;color:var(--muted);margin-bottom:4px}
        .plan-price{font-size:1.5rem;font-weight:900;color:var(--txt);line-height:1}
        .plan-unit{font-size:.72rem;color:var(--muted)}
        .plan-save{font-size:.63rem;color:var(--gold);margin-top:4px;font-weight:700}

        .btn-upgrade{width:100%;padding:14px;border-radius:var(--radius);border:none;
          background:linear-gradient(135deg,var(--acc2),var(--acc));color:#fff;font-family:inherit;
          font-size:.95rem;font-weight:700;cursor:pointer;margin-bottom:7px;letter-spacing:.03em}
        .btn-cancel{width:100%;padding:9px;border-radius:var(--radius);border:1px solid var(--bdr);
          background:transparent;color:var(--muted);font-family:inherit;font-size:.8rem;cursor:pointer}

        @media(max-width:480px){
          .g3{grid-template-columns:repeat(2,1fr)}
          .sum-grid{grid-template-columns:repeat(2,1fr)}
          .sum-val{font-size:2rem}
          .export-grid{grid-template-columns:1fr}
        }
      `}</style>

      <div className="app">
        {/* ヘッダー */}
        <div className="hdr">
          <div className="hdr-title">給料チェック</div>
          <div className="hdr-sub">NIGHT WORK SALARY CALCULATOR</div>
          {isPremium && (
            <div>
              <span className="prem-badge">✦ PREMIUM</span>
              <span className="plan-badge">{plan === "yearly" ? "年間プラン" : "月額プラン"}</span>
            </div>
          )}
        </div>

        {/* サマリー */}
        <div className="summary">
          <div className="sum-lbl">合計手取り</div>
          <div className="sum-val">{formatYen(totals.net)}</div>
          <div className="sum-grid">
            <div className="si"><div className="sil">総支給</div><div className="siv p">{formatYen(totals.gross)}</div></div>
            <div className="si"><div className="sil">バック計</div><div className="siv g">{formatYen(totals.back)}</div></div>
            <div className="si"><div className="sil">指名計</div><div className="siv g">{formatYen(totals.shimei)}</div></div>
            <div className="si"><div className="sil">控除計</div><div className="siv r">-{formatYen(totals.deductions)}</div></div>
            <div className="si"><div className="sil">シフト数</div><div className="siv">{shifts.length}回</div></div>
            {isPremium
              ? <div className="si"><div className="sil">年収推計</div><div className="siv g">{formatYen(annualIncome)}</div></div>
              : <div className="si" style={{cursor:"pointer"}} onClick={()=>setShowUpgrade(true)}>
                  <div className="sil">年収推計</div><div className="siv" style={{fontSize:".72rem",color:"var(--acc)"}}>🔒 Premium</div>
                </div>
            }
          </div>
        </div>

        {/* タブ */}
        <div className="tabs">
          {[
            { key:"shifts", label:"📋 シフト" },
            { key:"tax",    label:"💰 税金",  locked:!isPremium },
            { key:"ledger", label:"📊 仕分け", locked:!isPremium },
            { key:"export", label:"📄 出力",  locked:!isPremium },
          ].map(({ key, label, locked }) => (
            <button key={key}
              className={`tab${tab===key?" active":""}${locked?" locked":""}`}
              onClick={() => handleTabClick(key)}>
              {label}{locked && " 🔒"}
            </button>
          ))}
        </div>

        {/* ─ シフトタブ ─ */}
        {tab === "shifts" && (
          <>
            <div className="ptabs">
              {["週次","月次","旬払い"].map(p => (
                <button key={p} className={`ptab${period===p?" active":""}`} onClick={()=>setPeriod(p)}>{p}</button>
              ))}
            </div>

            {/* カレンダー */}
            <ShiftCalendar
              shifts={shifts}
              calYear={calYear} calMonth={calMonth}
              onMonthChange={handleMonthChange}
              onDayClick={handleDayClick}
            />

            {/* シフト一覧 */}
            {shifts
              .slice()
              .sort((a,b) => (a.date||"").localeCompare(b.date||""))
              .map(s => (
                <div key={s.id} id={`shift-${s.id}`}>
                  <ShiftRow shift={s} onChange={updateShift} onDelete={deleteShift} />
                </div>
              ))}
            <button className="btn-add" onClick={()=>addShift()}>＋ シフトを追加</button>
          </>
        )}

        {/* ─ 税金タブ ─ */}
        {tab === "tax" && isPremium && (
          <>
            <div className="panel">
              <div className="panel-title">⚙️ 申告設定</div>
              <label className="toggle-wrap" onClick={()=>setIsSideJob(!isSideJob)}>
                <div className={`toggle${isSideJob?" on":""}`} />
                <span className="toggle-lbl">副業として申告する（会社員 + 夜職）</span>
              </label>
              {isSideJob && (
                <label className="fw">
                  <span>会社員の年収 (¥)</span>
                  <input type="number" placeholder="3500000" value={employmentIncome}
                    onChange={e=>setEmploymentIncome(e.target.value)} className="inp" style={{marginTop:4}} />
                </label>
              )}
              <div style={{marginTop:10,padding:"7px 11px",background:"rgba(139,92,246,.08)",borderRadius:8,fontSize:".7rem",color:"var(--muted)"}}>
                集計期間「{period}」で換算した年収推計：<strong style={{color:"var(--acc2)"}}>{formatYen(annualIncome)}</strong> をもとに計算
              </div>
            </div>
            <div className="panel">
              <div className="panel-title">📋 税金シミュレーション</div>
              {[
                ["基礎控除", taxResult.basicDeduction, "p"],
                isSideJob && ["給与所得控除", taxResult.employDeduction, "p"],
                !isSideJob && ["青色申告特別控除（65万）", taxResult.businessDeduction, "p"],
                ["課税所得", taxResult.taxableIncome, "p"],
              ].filter(Boolean).map(([l,v,c]) => (
                <div className="tax-row" key={l}>
                  <span className="tax-lbl">{l}</span><span className={`tax-val ${c}`}>{formatYen(v)}</span>
                </div>
              ))}
              <div style={{height:6}}/>
              {[
                ["所得税（復興税込）", taxResult.incomeTax, "r"],
                ["住民税（概算）", taxResult.residentTax, "r"],
                !isSideJob && ["国民健康保険（概算）", taxResult.socialInsurance, "r"],
              ].filter(Boolean).map(([l,v,c]) => (
                <div className="tax-row deduct" key={l}>
                  <span className="tax-lbl">{l}</span><span className={`tax-val ${c}`}>{formatYen(v)}</span>
                </div>
              ))}
              <div className="tax-row total" style={{marginTop:7}}>
                <span className="tax-lbl">税・保険料合計</span>
                <span className="tax-val r">{formatYen(taxResult.totalTax)}</span>
              </div>
              <div className="tax-row total">
                <span className="tax-lbl" style={{fontWeight:700}}>税引後手取り（年間推計）</span>
                <span className="tax-val g" style={{fontSize:"1.05rem"}}>{formatYen(taxResult.takeHome)}</span>
              </div>
            </div>
            <div style={{fontSize:".66rem",color:"var(--muted)",textAlign:"center",padding:"0 8px"}}>
              ※概算です。正確な申告は税理士または最寄りの税務署にご相談ください。
            </div>
          </>
        )}

        {/* ─ 仕分けタブ ─ */}
        {tab === "ledger" && isPremium && (
          <div className="panel">
            <div className="panel-title">📊 申告用 勘定科目別仕分け</div>
            <table className="ledger-table">
              <thead><tr><th>日付</th><th>科目名</th><th>カテゴリ</th><th style={{textAlign:"right"}}>金額</th></tr></thead>
              <tbody>
                {ledgerRows.length === 0
                  ? <tr><td colSpan={4} style={{textAlign:"center",color:"var(--muted)",padding:"20px"}}>シフトを入力すると仕分けが表示されます</td></tr>
                  : ledgerRows.map((r,i) => (
                    <tr key={i}>
                      <td>{r.date}</td><td>{r.name}</td>
                      <td><span className={`bdg ${r.type}`}>{r.category}</span></td>
                      <td style={{textAlign:"right",fontWeight:700}}>{formatYen(r.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ─ 出力タブ ─ */}
        {tab === "export" && isPremium && (
          <div className="panel">
            <div className="panel-title">📄 データ出力</div>
            <div className="export-grid">
              <button className="export-btn" onClick={handleSave}>
                <span className="icon">💾</span><span>データ保存</span>
                <span style={{fontSize:".65rem",color:"var(--muted)"}}>ブラウザに保存</span>
              </button>
              <button className="export-btn" onClick={handlePrint}>
                <span className="icon">🖨️</span><span>PDF出力</span>
                <span style={{fontSize:".65rem",color:"var(--muted)"}}>印刷・PDF保存</span>
              </button>
              <button className="export-btn" onClick={()=>{
                const csv = ["日付,出勤,退勤,時給分,バック,指名計,控除,手取り",
                  ...shifts.map(s=>{const c=calcShiftResult(s);return`${s.date},${s.startTime},${s.endTime},${Math.round(c.hourPay)},${Math.round(c.back)},${Math.round(c.shimei+c.honShimei)},${Math.round(c.deductions)},${Math.round(c.net)}`;})
                ].join("\n");
                const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
                const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="給料データ.csv";a.click();URL.revokeObjectURL(url);
              }}>
                <span className="icon">📊</span><span>CSV出力</span>
                <span style={{fontSize:".65rem",color:"var(--muted)"}}>Excel対応</span>
              </button>
              <button className="export-btn" onClick={()=>{
                const data=JSON.stringify({shifts,exportedAt:new Date().toISOString()},null,2);
                const blob=new Blob([data],{type:"application/json"});
                const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="給料データ.json";a.click();URL.revokeObjectURL(url);
              }}>
                <span className="icon">📁</span><span>バックアップ</span>
                <span style={{fontSize:".65rem",color:"var(--muted)"}}>JSONで保存</span>
              </button>
            </div>
            <div className="save-msg">{savedMsg}</div>
          </div>
        )}
      </div>

      {/* アップグレードモーダル */}
      {showUpgrade && (
        <div className="modal-overlay" onClick={()=>setShowUpgrade(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">✦ Premium</div>
            <div className="modal-sub">夜職専用の高機能プランにアップグレード</div>
            <ul className="feat-list">
              <li>💰 所得税・住民税シミュレーション（フリーランス / 副業両対応）</li>
              <li>📊 確定申告用 勘定科目別仕分け</li>
              <li>💾 シフトデータの自動保存（ブラウザ永続）</li>
              <li>📄 PDF明細書の印刷・出力</li>
              <li>📊 CSV・JSONバックアップ</li>
            </ul>

            {/* プラン選択 */}
            <div className="plan-select">
              <div className={`plan-card${upgradePlan==="monthly"?" selected":""}`}
                onClick={()=>setUpgradePlan("monthly")}>
                <div className="plan-name">月額プラン</div>
                <div className="plan-price">¥980</div>
                <div className="plan-unit">/月</div>
                <div className="plan-save" style={{color:"var(--muted)"}}>いつでも解約可</div>
              </div>
              <div className={`plan-card${upgradePlan==="yearly"?" selected":""}`}
                onClick={()=>setUpgradePlan("yearly")} style={{position:"relative"}}>
                <div className="plan-card-badge">🎉 2ヶ月分お得！</div>
                <div className="plan-name">年間プラン</div>
                <div className="plan-price">¥9,800</div>
                <div className="plan-unit">/年</div>
                <div className="plan-save">¥1,960 お得</div>
              </div>
            </div>

            <button className="btn-upgrade" onClick={()=>handleActivatePremium(upgradePlan)}>
              ✦ {upgradePlan==="yearly"?"年間プランで始める（¥9,800/年）":"月額プランで始める（¥980/月）"}
            </button>
            <button className="btn-cancel" onClick={()=>setShowUpgrade(false)}>キャンセル</button>
          </div>
        </div>
      )}
    </>
  );
}
