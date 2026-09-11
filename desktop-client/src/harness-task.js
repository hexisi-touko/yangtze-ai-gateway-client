class HarnessTask { constructor({ url }) { this.url = url } async submit(input) { const res = await fetch(`${this.url}api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); if (!res.ok) throw new Error(`工作台请求失败：${res.status}`); return res.json() } }
module.exports = { HarnessTask }
