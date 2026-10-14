import { getStore } from '@netlify/blobs';

const store = () => getStore('king-s-ore-online-rooms-v1');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
const now = () => Date.now();
const cleanRoom = r => ({ id: String(r.id), name: String(r.name || 'Servidor do Reino').slice(0, 32), visibility: r.visibility === 'private' ? 'private' : 'public', max: Math.max(2, Math.min(8, Number(r.max) || 8)), pvp: !!r.pvp, host: String(r.host || 'Aventureiro').slice(0, 24), players: Math.max(1, Number(r.players) || 1), stage: Math.max(0, Math.min(4, Number(r.stage) || 0)), mode: 'online', updated: Number(r.updated) || now(), publicUrl: r.publicUrl || null, status: r.status || 'open' });
async function getRooms(db) { return await db.get('directory', { type: 'json' }) || {}; }
async function putRooms(db, rooms) { await db.setJSON('directory', rooms); }
export default async (request) => {
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type' } });
  const db = store(); const url = new URL(request.url); let roomId = url.searchParams.get('room'); let playerId = url.searchParams.get('player');
  try {
    const rooms = await getRooms(db);
    if (request.method === 'GET' && url.searchParams.get('action') === 'leaderboard') {
      const records = await db.get('completion-leaderboard-v1', { type: 'json' }) || [];
      return json({ records: (Array.isArray(records) ? records : []).sort((a,b) => Number(a.elapsedMs)-Number(b.elapsedMs)).slice(0,10) });
    }
    if (request.method === 'GET' && roomId && playerId) {
      const players = await db.get(`players-${roomId}`, { type: 'json' }) || {};
      const alive = Object.values(players).filter(p => now() - (p.updated || 0) < 18000);
      return json({ players: alive.map(p => ({ ...p, id: p.id })) });
    }
    if (request.method === 'GET') {
      const list = Object.values(rooms).filter(r => r && r.mode !== 'solo' && r.status !== 'closed' && now() - (r.updated || 0) < 120000).map(cleanRoom);
      return json({ rooms: list });
    }
    if (request.method === 'POST') {
      const body = await request.json();
      roomId = roomId || body.roomId || body.room?.id || null; playerId = playerId || body.playerId || null;
      if (body.action === 'leaderboard-submit') {
        const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0,24);
        const elapsedMs = Math.floor(Number(body.elapsedMs));
        const runId = String(body.runId || '').slice(0,100);
        if (name.length < 2) return json({ error: 'Digite um nome com pelo menos 2 caracteres.' }, 400);
        if (!Number.isFinite(elapsedMs) || elapsedMs < 60000 || elapsedMs > 7*24*60*60*1000) return json({ error: 'Tempo de zeramento inválido.' }, 400);
        if (!runId) return json({ error: 'Identificador de zeramento ausente.' }, 400);
        const records = await db.get('completion-leaderboard-v1', { type: 'json' }) || [];
        const list = Array.isArray(records) ? records : [];
        const existing = list.find(r => r.runId === runId);
        if (existing) {
          list.sort((a,b) => Number(a.elapsedMs)-Number(b.elapsedMs));
          return json({ ok: true, duplicate: true, rank: list.findIndex(r => r.runId === runId)+1, records: list.slice(0,10) });
        }
        const record = { name, elapsedMs, runId, date: new Date().toISOString() };
        list.push(record); list.sort((a,b) => Number(a.elapsedMs)-Number(b.elapsedMs));
        const top = list.slice(0,100);
        await db.setJSON('completion-leaderboard-v1', top);
        const rank = top.findIndex(r => r.runId === runId)+1;
        return json({ ok: true, rank: rank || null, records: top.slice(0,10) }, 201);
      }
      if (body.action === 'state' && roomId) {
        const r = rooms[String(roomId)];
        if (!r || r.status === 'closed') return json({ error: 'Sala não encontrada.' }, 404);
        const players = await db.get(`players-${roomId}`, { type: 'json' }) || {};
        if (body.playerId && body.player) players[String(body.playerId)] = { ...body.player, id: String(body.playerId), updated: now() };
        for (const [id, p] of Object.entries(players)) if (now() - (p.updated || 0) > 18000) delete players[id];
        await db.setJSON(`players-${roomId}`, players);
        r.players = Math.max(1, Object.keys(players).length); r.updated = now(); rooms[String(roomId)] = r; await putRooms(db, rooms);
        return json({ ok: true });
      }
      const input = body.room || {};
      if (body.action === 'create' || (input.id && !body.action)) {
        let id = String(input.id || ''); if (!/^\d{6}$/.test(id)) { do { id = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms[id]); }
        const room = cleanRoom({ ...input, id, players: 1, updated: now(), status: 'open', mode: 'online' });
        room.publicUrl = new URL(`/?sala=${id}`, url.origin).href;
        rooms[id] = room; await putRooms(db, rooms);
        return json({ ok: true, room }, 201);
      }
      return json({ error: 'Ação inválida.' }, 400);
    }
    if (request.method === 'DELETE' && roomId && playerId) {
      const players = await db.get(`players-${roomId}`, { type: 'json' }) || {}; delete players[String(playerId)]; await db.setJSON(`players-${roomId}`, players);
      const r = rooms[String(roomId)]; if (r) { r.players = Math.max(1, Object.keys(players).length); r.updated = now(); rooms[String(roomId)] = r; await putRooms(db, rooms); }
      return json({ ok: true });
    }
    return json({ error: 'Método não suportado.' }, 405);
  } catch (error) { return json({ error: 'Falha no diretório de salas.', detail: String(error?.message || error) }, 500); }
};
