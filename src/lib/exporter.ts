import type { Group } from "../types";
import {
  computeBalances,
  groupTotals,
  isPayment,
  memberName,
  paymentRecipient,
  settle,
  txShares,
} from "./finance";
import { dateStamp, safeName } from "./format";
import { exportBackup as storeBackup } from "./store";

function fmtMoney(cur: string, n: number): string {
  return cur + (Number(n) || 0).toFixed(2);
}

function csvEscape(val: unknown): string {
  const s = String(val ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function sortedTx(g: Group) {
  return [...g.transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt,
  );
}

/* ---------- CSV ---------- */
export function buildCsv(g: Group, greedy: boolean): string {
  const cur = g.currency || "";
  const rows: unknown[][] = [];
  rows.push(["Splitwiser export", g.name, "Generated " + new Date().toLocaleString()]);
  rows.push([]);

  rows.push(["TRANSACTIONS"]);
  rows.push(["Date", "Type", "Description", "Category", "Amount", "Paid by", "Split type", "Participants", "Per-person breakdown", "Note"]);
  for (const t of sortedTx(g)) {
    const shares = txShares(t);
    const breakdown = t.split.among
      .map((id) => `${memberName(g, id)}: ${fmtMoney(cur, (shares[id] ?? 0) / 100)}`)
      .join("; ");
    const participants = t.split.among.map((id) => memberName(g, id)).join("; ");
    rows.push([t.date, isPayment(t) ? "Payment" : "Expense", t.description, t.category, fmtMoney(cur, t.amount), memberName(g, t.paidBy), t.split.type, participants, breakdown, t.note]);
  }

  const payments = sortedTx(g).filter(isPayment);
  if (payments.length) {
    rows.push([]);
    rows.push(["SETTLEMENT PAYMENTS RECORDED"]);
    rows.push(["Date", "From (paid)", "To (received)", "Amount", "Note"]);
    for (const t of payments) {
      const to = paymentRecipient(t);
      rows.push([t.date, memberName(g, t.paidBy), to ? memberName(g, to) : "—", fmtMoney(cur, t.amount), t.note]);
    }
  }

  rows.push([]);
  rows.push(["BALANCES (net)"]);
  rows.push(["Member", "Net", "Status"]);
  const bal = computeBalances(g);
  for (const m of g.members) {
    const v = bal[m.id] ?? 0;
    const status = v > 0.004 ? "is owed" : v < -0.004 ? "owes" : "settled";
    rows.push([m.name, fmtMoney(cur, v), status]);
  }

  rows.push([]);
  rows.push([`STILL OUTSTANDING (${greedy ? "greedy / minimal payments" : "direct / traceable"})`]);
  rows.push(["From (pays)", "To (receives)", "Amount"]);
  for (const s of settle(g, greedy)) {
    rows.push([memberName(g, s.from), memberName(g, s.to), fmtMoney(cur, s.amount)]);
  }

  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export function exportCsv(g: Group, greedy: boolean) {
  download(`${safeName(g.name)}_${dateStamp()}.csv`, buildCsv(g, greedy), "text/csv");
}

/* ---------- PDF (via the browser's print dialog → "Save as PDF") ---------- */
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function buildReportHtml(g: Group, greedy: boolean): string {
  const cur = g.currency || "";
  const totals = groupTotals(g);
  const bal = computeBalances(g);
  let html = "";

  html += `<h1>${esc(g.name)}</h1>`;
  html += `<div class="meta">Splitwiser report · Generated ${esc(new Date().toLocaleString())} · ${totals.members} members · ${totals.count} expenses · Total spent ${esc(fmtMoney(cur, totals.total))}${totals.payments ? ` · ${totals.payments} settlement(s) recorded` : ""}</div>`;

  html += "<h2>Transactions</h2>";
  html += '<table><thead><tr><th>Date</th><th>Description</th><th>Paid by</th><th class="num">Amount</th><th>Split among</th></tr></thead><tbody>';
  const txs = sortedTx(g);
  if (!txs.length) html += '<tr><td colspan="5">No transactions.</td></tr>';
  for (const t of txs) {
    const among = t.split.among.map((id) => memberName(g, id)).join(", ");
    const label = isPayment(t) ? `${t.category} ${t.description} (payment)` : `${t.category} ${t.description}`;
    html += `<tr><td>${esc(t.date)}</td><td>${esc(label)}${t.note ? `<br><small>${esc(t.note)}</small>` : ""}</td><td>${esc(memberName(g, t.paidBy))}</td><td class="num">${esc(fmtMoney(cur, t.amount))}</td><td>${esc(among)}</td></tr>`;
  }
  html += "</tbody></table>";

  const paid = txs.filter(isPayment);
  if (paid.length) {
    html += "<h2>Payments recorded</h2>";
    html += '<table><thead><tr><th>Date</th><th>Paid</th><th>Received</th><th class="num">Amount</th><th>Note</th></tr></thead><tbody>';
    for (const t of paid) {
      const to = paymentRecipient(t);
      html += `<tr><td>${esc(t.date)}</td><td>${esc(memberName(g, t.paidBy))}</td><td>${esc(to ? memberName(g, to) : "—")}</td><td class="num">${esc(fmtMoney(cur, t.amount))}</td><td>${esc(t.note)}</td></tr>`;
    }
    html += "</tbody></table>";
  }

  html += "<h2>Balances</h2>";
  html += '<table><thead><tr><th>Member</th><th class="num">Net balance</th><th>Status</th></tr></thead><tbody>';
  for (const m of g.members) {
    const v = bal[m.id] ?? 0;
    const cls = v > 0.004 ? "pos" : v < -0.004 ? "neg" : "";
    const status = v > 0.004 ? "is owed" : v < -0.004 ? "owes" : "settled";
    html += `<tr><td>${esc(m.name)}</td><td class="num ${cls}">${esc(fmtMoney(cur, v))}</td><td>${status}</td></tr>`;
  }
  html += "</tbody></table>";

  html += `<h2>Still outstanding — ${greedy ? "greedy (minimal payments)" : "direct (traceable)"}</h2>`;
  const plan = settle(g, greedy);
  if (!plan.length) {
    html += "<p>Everyone is settled up.</p>";
  } else {
    html += '<table><thead><tr><th>Pays</th><th>Receives</th><th class="num">Amount</th></tr></thead><tbody>';
    for (const s of plan) {
      html += `<tr><td>${esc(memberName(g, s.from))}</td><td>${esc(memberName(g, s.to))}</td><td class="num">${esc(fmtMoney(cur, s.amount))}</td></tr>`;
    }
    html += "</tbody></table>";
  }

  html += '<div class="foot">Generated by Splitwiser · offline expense splitter</div>';
  return html;
}

export function exportPdf(g: Group, greedy: boolean) {
  const root = document.getElementById("print-root");
  if (!root) return;
  root.innerHTML = buildReportHtml(g, greedy);
  const prevTitle = document.title;
  document.title = `${safeName(g.name)}_${dateStamp()}`;
  const restore = () => {
    document.title = prevTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  setTimeout(() => window.print(), 60);
}

/* ---------- JSON backup ---------- */
export function exportBackupFile() {
  download(`splitwiser_backup_${dateStamp()}.json`, storeBackup(), "application/json");
}
