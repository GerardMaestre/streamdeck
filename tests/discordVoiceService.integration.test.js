const test = require('node:test');
const assert = require('node:assert/strict');

const discordVoiceService = require('../backend/discord/discordVoiceService');

function makeClient() {
  const handlers = new Map();
  return {
    user: { id: 'self' },
    async subscribe() {},
    async unsubscribe() {},
    async getVoiceSettings() { return { mute: false, deaf: false }; },
    async getChannel() { return { voice_states: [] }; },
    async request() { return { id: 'chan-1' }; },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(cb);
    },
    emitEvent(event, payload) {
      (handlers.get(event) || []).forEach((cb) => cb(payload));
    }
  };
}

function makeIo(events) {
  return { emit: (name, payload) => events.push({ name, payload }) };
}

test('DiscordVoiceService speaking pipeline: start -> silence(timeout fallback) -> stop', async () => {
  const svc = discordVoiceService;
  svc.speakingInactivityMs = 25;
  svc.explicitDominanceMs = 30;
  svc.speakingUsers.clear();
  svc.speakingTimeouts?.forEach((t) => clearTimeout(t));
  svc.speakingTimeouts = new Map();
  svc.speakingMeta = new Map();

  const events = [];
  const client = makeClient();
  svc.connectionManager = {
    rpc: client,
    isRpcReady: () => true,
    removeRpcListenersByEvent: () => {},
    voiceControlAvailable: true
  };
  svc.ioInstance = makeIo(events);

  await svc.setupRpcSubscriptions(client);

  client.emitEvent('SPEAKING_START', { user_id: 'u1' });
  await new Promise(r => setTimeout(r, 35));
  client.emitEvent('SPEAKING', { user_id: 'u1', speaking_state: 1 });
  await new Promise(r => setTimeout(r, 35));
  client.emitEvent('SPEAKING_STOP', { user_id: 'u1' });

  const speakingEvents = events.filter(e => e.name === 'discord_user_speaking' && e.payload.userId === 'u1');
  assert.equal(speakingEvents[0].payload.speaking, true);
  assert.equal(speakingEvents[1].payload.speaking, true);
  assert.equal(speakingEvents[1].payload.source, 'SPEAKING');
  assert.equal(speakingEvents[2].payload.speaking, false);
  assert.equal(speakingEvents[2].payload.source, 'timeout');
  assert.equal(speakingEvents[3].payload.speaking, false);
  assert.equal(speakingEvents[3].payload.source, 'SPEAKING_STOP');
});

test('DiscordVoiceService speaking pipeline: explicit dominates incomplete generic sequence', async () => {
  const svc = discordVoiceService;
  svc.speakingInactivityMs = 40;
  svc.explicitDominanceMs = 80;
  svc.speakingUsers.clear();
  svc.speakingTimeouts?.forEach((t) => clearTimeout(t));
  svc.speakingTimeouts = new Map();
  svc.speakingMeta = new Map();

  const events = [];
  const client = makeClient();
  svc.connectionManager = {
    rpc: client,
    isRpcReady: () => true,
    removeRpcListenersByEvent: () => {},
    voiceControlAvailable: true
  };
  svc.ioInstance = makeIo(events);

  await svc.setupRpcSubscriptions(client);

  client.emitEvent('SPEAKING_START', { user_id: 'u2' });
  client.emitEvent('SPEAKING', { user_id: 'u2', speaking_state: 0 });

  const speakingEvents = events.filter(e => e.name === 'discord_user_speaking' && e.payload.userId === 'u2');
  assert.equal(speakingEvents.length, 1);
  assert.equal(speakingEvents[0].payload.speaking, true);
  assert.equal(speakingEvents[0].payload.source, 'SPEAKING_START');
});
