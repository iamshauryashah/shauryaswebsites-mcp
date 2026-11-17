import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleMcp } from '../src/index.js';

function env(rows = []) {
  const calls = [];
  return {
    calls,
    FEEDBACK_STORE: {
      idFromName(name) { assert.equal(name, 'global'); return 'global-id'; },
      get(id) {
        assert.equal(id, 'global-id');
        return {
          async fetch(url, init) {
            assert.equal(url, 'https://feedback-store.internal/list-new');
            assert.equal(init.method, 'POST');
            const { offset, limit } = JSON.parse(init.body);
            calls.push({ offset, limit });
            const items = rows.slice(offset, offset + limit);
            return Response.json({ items, total: rows.length });
          }
        };
      }
    }
  };
}
function request(method, params, id = 1) {
  return new Request('https://mcp.shauryaswebsites.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
}
test('health endpoint', async () => {
  const response = await worker.fetch(new Request('https://mcp.shauryaswebsites.com/health'), env());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});
test('MCP initialize and tool listing', async () => {
  const e = env();
  const initialized = await (await handleMcp(request('initialize', {}),e)).json();
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  const listing = await (await handleMcp(request('tools/list', {}),e)).json();
  assert.deepEqual(listing.result.tools.map(t=>t.name), ['triage_all_new_feedback']);
  assert.equal(listing.result.tools[0].annotations.readOnlyHint, true);
});
test('triage reads Inbox without exposing emails, across multiple pages', async () => {
  const rows = Array.from({length: 205},(_,i)=>({
    id: 'id-'+i,message:'Issue '+i,site:'feedback.shauryaswebsites.com',
    status:'Inbox',created_at:'2026-11-16T00:00:00Z',updated_at:'2026-11-16T00:00:00Z',
    email:'private@example.com'
  }));
  const e = env(rows);
  const response = await handleMcp(request('tools/call', {name:'triage_all_new_feedback',arguments:{}}),e);
  assert.equal(response.status, 200);
  const payload = JSON.parse((await response.json()).result.content[0].text);
  assert.equal(payload.total, 205);
  assert.equal(payload.count, 205);
  assert.equal(payload.truncated, false);
  assert.equal(payload.items.length, 205);
  assert.equal(JSON.stringify(payload).includes('private@example.com'), false);
  assert.deepEqual(e.calls.map(c=>c.offset),[0,200]);
});
test('large queues report explicit truncation', async () => {
  const rows=Array.from({length:2001},(_,i)=>({id:String(i),message:'Report',site:'site',status:'Inbox'}));
  const result=await (await handleMcp(request('tools/call',{name:'triage_all_new_feedback',arguments:{}}),env(rows))).json();
  const payload=JSON.parse(result.result.content[0].text);
  assert.equal(payload.count,2000);
  assert.equal(payload.total,2001);
  assert.equal(payload.truncated,true);
});
test('invalid tool, arguments and cross-site origins are rejected', async () => {
  const e=env();
  const unknown=await (await handleMcp(request('tools/call',{name:'delete_all_feedback'}),e)).json();
  assert.equal(unknown.error.code,-32602);
  const argumentsError=await (await handleMcp(request('tools/call',{name:'triage_all_new_feedback',arguments:{admin:true}}),e)).json();
  assert.equal(argumentsError.error.code,-32602);
  const crossOrigin=new Request('https://mcp.shauryaswebsites.com/mcp',{
    method:'POST',headers:{'content-type':'application/json',Origin:'https://evil.example'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})
  });
  assert.equal((await handleMcp(crossOrigin,e)).status,403);
});
test('notifications are accepted without an RPC result', async()=>{
  const req=new Request('https://mcp.shauryaswebsites.com/mcp',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})
  });
  assert.equal((await handleMcp(req,env())).status,202);
});
