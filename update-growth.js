const fs = require('fs');

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'eduardoutsch';
const TOKEN = process.env.GITHUB_TOKEN;

async function fetchMonthlyContributions() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { login: USERNAME, from: from.toISOString(), to: now.toISOString() },
    }),
  });

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  const monthBuckets = new Map();

  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      const ym = day.date.slice(0, 7); // YYYY-MM
      monthBuckets.set(ym, (monthBuckets.get(ym) || 0) + day.contributionCount);
    }
  }

  const sortedMonths = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12);

  return {
    total: calendar.totalContributions,
    months: sortedMonths.map(([ym, count]) => {
      const [y, m] = ym.split('-');
      const label = new Date(Date.UTC(Number(y), Number(m) - 1, 1))
        .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
        .toUpperCase();
      return { ym, label: `${label} ${y.slice(2)}`, count };
    }),
  };
}

function buildSmoothPath(points) {
  if (points.length === 0) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = ((p0.x + p1.x) / 2).toFixed(1);
    d += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function renderSvg({ total, months }) {
  const left = 68;
  const right = 848;
  const top = 62;
  const bottom = 216;
  const maxVal = Math.max(...months.map((m) => m.count), 100);
  const ceilMax = Math.ceil(maxVal / 100) * 100;

  const stepX = (right - left) / Math.max(months.length - 1, 1);
  const points = months.map((m, i) => ({
    ...m,
    x: left + i * stepX,
    y: bottom - (m.count / ceilMax) * (bottom - top),
  }));

  const linePath = buildSmoothPath(points);
  const areaPath = `${linePath} L ${right} ${bottom} L ${left} ${bottom} Z`;
  const lastPt = points[points.length - 1];
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    val: Math.round(ceilMax * ratio),
    y: bottom - ratio * (bottom - top),
  }));

  const xLabels = points
    .filter((_, idx) => idx % 2 === 0 || idx === points.length - 1)
    .map((p) => `<text x="${p.x.toFixed(1)}" y="238">${p.label}</text>`)
    .join('\n    ');

  const nodeCircles = points
    .slice(1, -1)
    .filter((p) => p.count > 0)
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#d4a349" stroke="#171310" stroke-width="1.5"/>`
    )
    .join('\n  ');

  const badgeText = `${lastPt.label.split(' ')[0]} SURGE: ${lastPt.count.toLocaleString('en-US')}`;
  const badgeX = Math.max(left, lastPt.x - 138);
  const badgeY = Math.max(42, lastPt.y - 16);

  return `<svg width="900" height="260" viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="plateBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#171310"/>
      <stop offset="60%" stop-color="#1d1713"/>
      <stop offset="100%" stop-color="#120e0b"/>
    </linearGradient>

    <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#e0824d" stop-opacity="0.65"/>
      <stop offset="45%" stop-color="#d4a349" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#171310" stop-opacity="0.02"/>
    </linearGradient>

    <linearGradient id="curveStroke" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#9e6d24"/>
      <stop offset="45%" stop-color="#d4a349"/>
      <stop offset="80%" stop-color="#e0824d"/>
      <stop offset="100%" stop-color="#f3d08a"/>
    </linearGradient>

    <linearGradient id="scanSweep" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#d4a349" stop-opacity="0"/>
      <stop offset="50%" stop-color="#f3d08a" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#d4a349" stop-opacity="0"/>
    </linearGradient>

    <pattern id="chartGrid" width="40" height="32" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 32" fill="none" stroke="#d4a349" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="900" height="260" rx="10" fill="url(#plateBg)"/>
  <rect width="900" height="260" rx="10" fill="url(#chartGrid)"/>

  <!-- Continuous Auspex Scanner Sweep -->
  <rect x="64" y="54" width="90" height="162" fill="url(#scanSweep)">
    <animate attributeName="x" from="64" to="762" dur="6s" repeatCount="indefinite"/>
  </rect>

  <rect x="1" y="1" width="898" height="258" rx="9" fill="none" stroke="#78552b" stroke-width="1.5"/>
  <circle cx="14" cy="14" r="3" fill="#d4a349"/>
  <circle cx="886" cy="14" r="3" fill="#d4a349"/>
  <circle cx="14" cy="246" r="3" fill="#d4a349"/>
  <circle cx="886" cy="246" r="3" fill="#d4a349"/>

  <circle cx="34" cy="28" r="4" fill="#e0824d">
    <animate attributeName="opacity" values="1;0.3;1" dur="2.2s" repeatCount="indefinite"/>
  </circle>
  <text x="48" y="32" font-family="Courier New, monospace" font-weight="bold" font-size="13" fill="#e3b459">LIVE CONTRIBUTION TRAJECTORY  //  ROLLING 12-MONTH TELEMETRY</text>
  <text x="868" y="32" text-anchor="end" font-family="Courier New, monospace" font-weight="bold" font-size="12" fill="#cbb99d">${total.toLocaleString('en-US')} ANNUAL COMMITS</text>

  <g stroke="#6e532e" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 4">
    ${yTicks
      .slice(0, -1)
      .map((t) => `<line x1="64" y1="${t.y.toFixed(1)}" x2="852" y2="${t.y.toFixed(1)}"/>`)
      .join('\n    ')}
    <line x1="64" y1="216" x2="852" y2="216" stroke-dasharray="none" stroke-opacity="0.7"/>
  </g>

  <g font-family="Courier New, monospace" font-size="11" fill="#9e6d24" text-anchor="end">
    ${yTicks.map((t) => `<text x="54" y="${(t.y + 4).toFixed(1)}">${t.val}</text>`).join('\n    ')}
  </g>

  <path d="${areaPath}" fill="url(#areaGrad)">
    <animate attributeName="opacity" values="0.72;1;0.72" dur="4.5s" repeatCount="indefinite"/>
  </path>

  <path d="${linePath}"
        fill="none"
        stroke="url(#curveStroke)"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-dasharray="960"
        stroke-dashoffset="960">
    <animate attributeName="stroke-dashoffset" from="960" to="0" dur="2.2s" fill="freeze"/>
  </path>

  ${nodeCircles}

  <circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="10" fill="none" stroke="#e0824d" stroke-width="1.5">
    <animate attributeName="r" values="5;15;5" dur="2.2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.95;0;0.95" dur="2.2s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="5.5" fill="#f3d08a" stroke="#e0824d" stroke-width="2"/>

  <rect x="${badgeX.toFixed(1)}" y="${badgeY.toFixed(1)}" width="128" height="22" rx="4" fill="#261e16" stroke="#e0824d" stroke-width="1"/>
  <text x="${(badgeX + 64).toFixed(1)}" y="${(badgeY + 15).toFixed(1)}" text-anchor="middle" font-family="Courier New, monospace" font-weight="bold" font-size="11" fill="#f3d08a">${badgeText}</text>

  <g font-family="Courier New, monospace" font-size="11" fill="#cbb99d" text-anchor="middle">
    ${xLabels}
  </g>
</svg>`;
}

(async () => {
  const stats = await fetchMonthlyContributions();
  fs.writeFileSync('growth.svg', renderSvg(stats), 'utf8');
  console.log(`Updated growth.svg (${stats.total} annual contributions)`);
})();
