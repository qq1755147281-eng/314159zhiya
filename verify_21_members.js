/* ============================================================
 *  规则 20 · 21 名真实会员验证脚本
 * ============================================================ */
'use strict';
const fs = require('fs');
const html = fs.readFileSync('/workspace/index.html', 'utf8');
// 提取 initApplyDetail 范围：从 "(function initApplyDetail" 到 "\n})();\n" 之前的 DB / 工具函数
const start = html.indexOf('(function initApplyDetail(){');
const end = html.indexOf('/* ================ 首页 · 生态分红池', start);
let core = html.slice(start, end);
// 去除 DOM 依赖：document.getElementById / setInterval / addEventListener 等全部不再执行
// 方法：把整个 IIFE 的所有行中，对 DOM 访问的函数体清空（只取纯逻辑部分）
// 实际上更简单：直接把需要的工具函数 + DB 构造代码剥离出来 eval
const vm = require('vm');

const sandbox = {
    // shim 中 window = this，所以 this（即 sandbox 本身）必须具备 window 上需要的所有方法
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    matchMedia(){ return { matches:false, addListener(){}, removeListener(){} }; },
    // setInterval/setTimeout 全部用 no-op 避免真实调度导致进程不退出
    setInterval(){ return 0; }, clearInterval(){},
    setTimeout(){ return 0; }, clearTimeout(){},
    Date, Math, JSON, console, Array, Object, String, Number, Proxy,
    localStorage: { _s:{}, setItem(k,v){ this._s[k]=v; }, getItem(k){ return this._s[k]||null; } },
    navigator: {},
    document: new Proxy({
        head: {}, documentElement: {},
        body: { classList:{ add(){}, remove(){} } },
        addEventListener(){}, createElement(){ return { appendChild(){}, classList:{ add(){} } }; },
        getElementById(){ return null; }, querySelector(){ return null; },
        querySelectorAll(){ return []; },
        removeEventListener(){},
        createDocumentFragment(){ return { appendChild(){} }; },
    }, {
        get(target, prop, receiver){
            if (prop in target) return target[prop];
            return function(){ return typeof prop === 'string' && prop.endsWith('SelectorAll') ? [] : null; };
        }
    }),
};
// 确保 document.head / document.documentElement 各自具备 appendChild 空函数
sandbox.document.head.appendChild = function(){};
sandbox.document.documentElement.appendChild = function(){};
vm.createContext(sandbox);

// 注入最小 shim：window = this（即 sandbox），使得代码中对 window 的引用可用
const shim = `
    window = this;
`;

// 把整个 initApplyDetail IIFE 包起来执行（它会自己挂 window.MEMBER_DB 和 window.__memberUtils）
const codeToRun = shim + '\n;(function(){\n' +
    // 只截取 IIFE 函数体（去掉最外层 "(function initApplyDetail(){" 和 "})();"）
    (function(){
        const body = html.slice(start, end);
        // body 开头是 "(function initApplyDetail(){"
        const first = body.indexOf('{');
        // 找最后一个 "})()" 之前的闭包尾
        // 简化：用第一个字符到倒数 7 个字符的方式并不稳妥，这里直接去掉外层 2 个 token
        const s = body.indexOf('{') + 1;
        const e = body.lastIndexOf('})()');
        return body.slice(s, e > 0 ? e : body.length);
    })() +
    '\n})();\n' +
    // 额外导出
    `this.__out = { DB: window.MEMBER_DB, U: window.__memberUtils };`;

vm.runInContext(codeToRun, sandbox);
const { DB, U } = sandbox.__out;

const results = [];
function check(name, cond, detail){
    results.push({ name, pass: !!cond, detail: detail || '' });
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

/* A. 基础结构检查 */
check('DB 长度 = 21', DB.length === 21, `actual=${DB.length}`);
check('会员 id 1..21 严格连续', DB[0].id===1 && DB[20].id===21 && DB[5].id===6);
check('21 人均有 holdDateMs 字段', DB.every(m => typeof m.holdDateMs === 'number' && m.holdDateMs > 0));
check('21 人均有一张且仅一张卡（规则 20 表格格式）', DB.every(m => Array.isArray(m.cards) && m.cards.length === 1));
check('21 人手机号均为 11 位数字', DB.every(m => /^1\d{10}$/.test(String(m.phone))));
check('21 人姓名非空 ≥ 2 字', DB.every(m => typeof m.name==='string' && m.name.length>=2));

/* B. 个人字段抽查 */
const m1 = DB.find(x => x.id === 1);
check('① 李耿 手机号=15625884555', m1 && m1.name === '李耿' && m1.phone === '15625884555');
check('① 李耿 持有时间 2026-07-15 & 质押 360 天',
    m1 && U.memberStartDate(m1) === '2026-07-15' && m1.cards[0].pledgeDays === 360,
    `holdDate=${U.memberStartDate(m1)} pledge=${m1 && m1.cards[0].pledgeDays}`);
check('① 李耿 派友AI卡1级 (ai+1000)',
    m1 && m1.cards[0].type==='ai' && m1.cards[0].price===1000 &&
    /AI卡1级/.test(U.memberTypeLabel(m1, {})));
// 分红率验证：0.15 π/h × 2 张 × 24h = 7.2 π /天
function ymd(y,mo,d){const dt=new Date();dt.setFullYear(y);dt.setMonth(mo-1);dt.setDate(d);dt.setHours(0,0,0,0);return dt.getTime();}
const LIGENG_START = ymd(2026,7,15);
const ONE_DAY_MS = 86400000;
// 2026-07-15 00:00 经过 1 天 → 应 = 7.2 π
const day1 = U.computeCardDivi(m1.cards[0], LIGENG_START + 1*ONE_DAY_MS);
check('① 李耿 1 天后派币 ≈ 7.20 π（0.15×2×24）', Math.abs(day1 - 7.2) < 1e-9, `actual=${day1}`);
// 30 天后：216 π
const day30 = U.computeCardDivi(m1.cards[0], LIGENG_START + 30*ONE_DAY_MS);
check('① 李耿 30 天后派币 = 216.00 π', Math.abs(day30 - 216) < 1e-6, `actual=${day30.toFixed(6)}`);
// 361 天后 → 质押到期后停止（360 天时达到峰值，361 天值相同）
const day360 = U.computeCardDivi(m1.cards[0], LIGENG_START + 360*ONE_DAY_MS);
const day361 = U.computeCardDivi(m1.cards[0], LIGENG_START + 361*ONE_DAY_MS);
check('① 李耿 360 天到期后停止（d360===d361）', Math.abs(day360 - day361) < 1e-9, `d360=${day360.toFixed(4)} d361=${day361.toFixed(4)}`);

/* C. 20 号 高小华：分红起算 2026-08-17 00:00（今天） */
const m20 = DB.find(x => x.id === 20);
check('⑳ 高小华 持有时间 2026-08-16 分红起算 2026-08-17',
    m20 && U.memberStartDate(m20) === '2026-08-16' && m20.cards[0].startMs === ymd(2026,8,17),
    `hold=${U.memberStartDate(m20)} diviStart=${new Date(m20 && m20.cards[0].startMs).toISOString().slice(0,10)}`);
check('⑳ 高小华 质押 30 天 AI卡1级 1 张',
    m20 && m20.cards[0].pledgeDays === 30 && m20.cards[0].qty === 1 &&
    /AI卡1级/.test(U.memberTypeLabel(m20, {})));
// 在 2026-08-17 06:00 → 6h × 0.15 = 0.90 π
const m20_6h = U.computeCardDivi(m20.cards[0], ymd(2026,8,17) + 6*3600000);
check('⑳ 高小华 起算日 6 小时后派币 ≈ 0.90 π', Math.abs(m20_6h - 0.90) < 1e-9, `actual=${m20_6h}`);

/* D. 21 号 候健红：股东卡1级 1 张，质押 9999 天 */
const m21 = DB.find(x => x.id === 21);
check('㉑ 候健红 手机=16601785571 股东卡1级 1 张',
    m21 && m21.name === '候健红' && m21.phone === '16601785571' &&
    m21.cards[0].type === 'share' && m21.cards[0].price === 1000 &&
    m21.cards[0].qty === 1 && /股东卡1级/.test(U.memberTypeLabel(m21, {})));
check('㉑ 候健红 质押 9999 天 起算 2026-08-17',
    m21 && m21.cards[0].pledgeDays === 9999 && m21.cards[0].startMs === ymd(2026,8,17));
// 100 年后也未到期（远大于 9999≈27.4 年 → 到期后值稳定）：30 年 vs 50 年应该相同（均超 9999 天）
const y30_ms = ymd(2026,8,17) + 30*365*ONE_DAY_MS;
const y50_ms = ymd(2026,8,17) + 50*365*ONE_DAY_MS;
const hjh_30y = U.computeCardDivi(m21.cards[0], y30_ms);
const hjh_50y = U.computeCardDivi(m21.cards[0], y50_ms);
check('㉑ 候健红 9999 天到期停止（30y后=50y后值）', Math.abs(hjh_30y - hjh_50y) < 1e-9, `hjh30y=${hjh_30y.toFixed(2)} hjh50y=${hjh_50y.toFixed(2)}`);

/* E. 卡类型标签（21 人覆盖：AI1 / AI2 / SH1 / SH2） */
function db(n){ return DB.find(x => x.id === n); }
check('② 王浩宇 id=2 → AI卡1级（¥1000）', /派友AI卡1级/.test(U.memberTypeLabel(db(2), {})));
check('④ 张泽睿 id=4 → AI卡2级（¥1500）', /派友AI卡2级/.test(U.memberTypeLabel(db(4), {})));
check('③ 李欣悦 id=3 → 派友股东卡2级（¥1500）', /派友股东卡2级/.test(U.memberTypeLabel(db(3), {})));
check('⑤ 刘若曦 id=5 → 派友股东卡1级（¥1000）', /派友股东卡1级/.test(U.memberTypeLabel(db(5), {})));

/* F. 分页与序号 */
const PAGE_SIZE = 10;
const TOTAL_PAGES = Math.ceil(DB.length / PAGE_SIZE);
check('TOTAL_PAGES = 3（10+10+1）', TOTAL_PAGES === 3, `actual=${TOTAL_PAGES}`);
function idsOnPage(p){
    const s = (p - 1) * PAGE_SIZE;
    const e = Math.min(s + PAGE_SIZE, DB.length);
    const arr = [];
    for (let i = s; i < e; i++) arr.push(DB[i].id);
    return arr;
}
check('第1页 id 1..10', JSON.stringify(idsOnPage(1)) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]));
check('第2页 id 11..20', JSON.stringify(idsOnPage(2)) === JSON.stringify([11,12,13,14,15,16,17,18,19,20]));
check('第3页 id 21', JSON.stringify(idsOnPage(3)) === JSON.stringify([21]));

/* G. 汇总卡数量：AI 总数、股东总数（手工求和） */
// AI 会员 (id:1,2,4,6,8,10,12,14,16,18,20) qty
let aiSum = 0, shSum = 0;
for (const m of DB){
    for (const c of m.cards){
        if (c.type === 'ai') aiSum += c.qty;
        else shSum += c.qty;
    }
}
const totals = U.computeTotals();
check('规则5 派友AI卡持有数量汇总正确', totals.aiTotal === aiSum, `expect=${aiSum} actual=${totals.aiTotal}`);
check('规则6 派友股东卡数量汇总正确',  totals.shTotal === shSum, `expect=${shSum} actual=${totals.shTotal}`);
console.log(`   → 手工核算：AI合计 ${aiSum} 张 / 股东合计 ${shSum} 张`);

/* H. 规则 20：先锋档案查询 — 姓名+手机号 全 21 人精确匹配 */
let allHit = true, missed = [];
for (const m of DB){
    const got = U.queryMember(m.phone, m.name);
    if (!got || got.id !== m.id) { allHit = false; missed.push(`#${m.id} ${m.name}/${m.phone}`); }
}
check('规则20 · 21 人查询 100% 精确命中', allHit, missed.length ? ('未命中: ' + missed.join('、')) : '');
// 额外：错姓名 / 错手机 / 空值 都不命中
check('姓名错误 → 不命中', U.queryMember(db(1).phone, '李耿_改') === null);
check('手机错误 → 不命中', U.queryMember('15625880000', db(1).name) === null);
check('空姓名 → 不命中', U.queryMember(db(1).phone, '') === null);
check('空手机 → 不命中', U.queryMember('', db(1).name) === null);

/* I. 抽查 ⑦ 周雨桐：股东卡2级 3张 质押190天 起算2026-07-30 → 0.02/h */
const m7 = db(7);
const m7Expect10h = 0.02 * 10 * 3; // 0.60 π
const m7After10h = U.computeCardDivi(m7.cards[0], m7.cards[0].startMs + 10*3600000);
check('⑦ 周雨桐 股东卡2级(0.02/h)×3张：10h=0.60π',
    Math.abs(m7After10h - m7Expect10h) < 1e-9, `actual=${m7After10h.toFixed(4)}`);
// ⑯ 江俊熙：AI卡2级(0.3/h) × 3张，10小时=9π
const m16 = db(16);
const m16After10h = U.computeCardDivi(m16.cards[0], m16.cards[0].startMs + 10*3600000);
check('⑯ 江俊熙 AI卡2级(0.3/h)×3张：10h=9.00π', Math.abs(m16After10h - 9.00) < 1e-9, `actual=${m16After10h.toFixed(4)}`);

/* ============ 汇总 ============ */
const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => !r.pass).length;
console.log('\n============= 验证总结 =============');
console.log(`总项: ${results.length}   通过: ${pass}   失败: ${fail}`);
console.log('====================================');
const fails = results.filter(r => !r.pass);
if (fails.length) {
    console.log('\n❌ 失败项:');
    fails.forEach(f => console.log('  - ' + f.name + (f.detail ? ' (' + f.detail + ')' : '')));
    process.exit(1);
} else {
    console.log('\n✅ 规则 20 · 21 名真实会员全部验证通过！');
}
