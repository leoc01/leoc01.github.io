// rede.js - dois no mesmo avião, sem servidor.
//
// Conexão direta entre os dois navegadores (WebRTC: dados + voz). O "encontro" é fora do jogo:
// quem convida gera um link e manda (WhatsApp etc.); quem recebe abre o link e devolve um código de
// resposta, que quem convidou cola no jogo. Os dois códigos são a descrição da conexão (SDP)
// comprimida; os endereços são descobertos por STUN público (grátis, não guarda nada). Nenhum dado
// fica em servidor nenhum.
//
// Quem está com os comandos calcula a física e manda ~20 retratos por segundo do avião; o outro só
// mostra (src/net.c interpola). Troca de comandos, sem confirmação:
//   T / L3 com os comandos .... solta: o outro põe a mão no manche e assume
//   T / L3 sem os comandos .... pega: a mão vai ao manche, assume, e o outro solta
//   (a mão de quem assume vai ao manche; depois o outro solta manche e manete; por fim a outra mão
//    de quem assumiu vai à manete — ver Cabin.prepare)
//   B / R3 (segurar) .......... fala no interfone (voz)      Enter ..... chat      G ..... este painel

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const SEND_HZ = 20;

const CSS = `
#rede { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #0b0606b0;
  font-family: "DejaVu Sans Condensed", "Roboto Condensed", "Arial Narrow", Arial, sans-serif; z-index: 20; }
#rede .card { background: #efe6d1; color: #2b211d; border-radius: 16px; width: min(520px, 94vw); box-shadow: 0 2px 0 #c9a24a inset, 0 24px 60px #000a; overflow: hidden; }
#rede .band { background: linear-gradient(#8a2420, #6e1a17); color: #f6efe0; padding: 12px 20px 9px; display: flex; justify-content: space-between; align-items: baseline; position: relative; }
#rede .band::after { content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 3px; background: #c9a24a; }
#rede .band b { font: italic 700 22px/1 "DejaVu Serif", Georgia, serif; }
#rede .band span { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.8; cursor: pointer; }
#rede .body { padding: 14px 20px 18px; font-size: 14.5px; line-height: 1.4; }
#rede p { margin: 0 0 10px; }
#rede .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
#rede .row label { min-width: 120px; color: #6b5c4c; }
#rede .seg { display: inline-flex; border: 1px solid #c9b590; border-radius: 9px; overflow: hidden; }
#rede .seg button { background: #f8f2e4; color: #6e1a17; border: 0; padding: 6px 12px; font: 700 13px/1 inherit; cursor: pointer; }
#rede .seg button.on { background: #8a2420; color: #f6efe0; }
#rede textarea { width: 100%; box-sizing: border-box; height: 74px; font: 12px/1.3 "DejaVu Sans Mono", Menlo, monospace; border: 1px solid #c9b590; border-radius: 8px; background: #fbf7ec; padding: 6px; resize: none; }
#rede .go { background: #8a2420; color: #f6efe0; border: 0; border-radius: 9px; padding: 9px 16px; font: 700 14px/1 inherit; cursor: pointer; }
#rede .go.sec { background: #d9c9a8; color: #6e1a17; }
#rede .st { color: #6b5c4c; font-size: 13px; min-height: 1.3em; }
#rede .hint { color: #8a7a68; font-size: 12.5px; }
#rede kbd { font: 700 11px/1 "DejaVu Sans Mono", monospace; background: #fbf7ec; border-radius: 4px; padding: 2px 5px; box-shadow: 0 1px 0 #9c8a6a; }
#juntos { position: fixed; left: 12px; top: 10px; color: #f6efe0; font: 600 12.5px/1.35 "DejaVu Sans Condensed", Arial, sans-serif;
  background: #1c1413b8; border: 1px solid #c9a24a55; border-radius: 10px; padding: 6px 10px; pointer-events: none; z-index: 5; }
#juntos .mic { color: #ff6b5a; }
#fala { position: fixed; left: 50%; bottom: 18%; transform: translateX(-50%); color: #fff; font: 700 17px/1.3 "DejaVu Sans Condensed", Arial, sans-serif;
  text-shadow: 0 1px 3px #000, 0 0 10px #000a; text-align: center; pointer-events: none; z-index: 5; transition: opacity 0.4s; }
#chat { position: fixed; left: 12px; bottom: 12px; width: min(420px, 70vw); z-index: 6; font: 14px/1.35 "DejaVu Sans Condensed", Arial, sans-serif; }
#chat .msg { color: #fff; text-shadow: 0 1px 2px #000; margin-top: 3px; transition: opacity 1s; }
#chat .msg b { color: #ffd77a; }
#chat input { width: 100%; box-sizing: border-box; margin-top: 6px; font: 14px/1.3 inherit; padding: 6px 9px; border-radius: 8px; border: 1px solid #c9a24a; background: #1c1413e6; color: #fff; outline: none; }
`;

async function packCode(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const cs = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackCode(code) {
  const b64 = code.trim().replace(/^.*#convite=/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(ds).text());
}

export class Rede {
  constructor(w, sound) {
    this.w = w; this.sound = sound;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.panel = document.createElement('div'); this.panel.id = 'rede'; this.panel.hidden = true; document.body.appendChild(this.panel);
    this.badge = document.createElement('div'); this.badge.id = 'juntos'; this.badge.hidden = true; document.body.appendChild(this.badge);
    this.fala = document.createElement('div'); this.fala.id = 'fala'; document.body.appendChild(this.fala);
    this.chat = document.createElement('div'); this.chat.id = 'chat'; document.body.appendChild(this.chat);
    this.on = false; this.typing = false; this.talking = false;
    this.cfg = { seat: 0 };
    this.lastSend = 0;
    this.padPrev = [false, false];
    this.padA = true;   // o A que comecou o jogo precisa ser solto antes
    const m = location.hash.match(/#convite=([\w-]+)/);
    if (m) { this.invite = m[1]; history.replaceState(null, '', location.pathname + location.search); }
  }

  // ---------- painel ----------
  open() {
    if (this.on) { this.renderConnected(); return; }
    if (this.invite) this.renderGuest(); else this.renderHost();
  }
  close() { this.panel.hidden = true; }
  card(title, body) {
    this.panel.innerHTML = `<div class="card"><div class="band"><b>${title}</b><span data-x>fechar</span></div><div class="body">${body}</div></div>`;
    this.panel.hidden = false;
    this.panel.querySelector('[data-x]').onclick = () => this.close();
    this.panel.onmousedown = (e) => e.stopPropagation();
    return this.panel;
  }
  renderHost() {
    const c = this.cfg;
    const seg = (name, opts) => `<span class="seg" data-k="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${c[name] === v ? 'on' : ''}">${t}</button>`).join('')}</span>`;
    const el = this.card('Voar junto', `
      <p>Duas pessoas no mesmo avião, cada uma no seu computador. Quem está com os comandos pilota; o outro vê tudo,
      conversa pelo interfone e pode pegar os comandos a qualquer hora. Nada passa por servidor: o convite vai
      pelo WhatsApp (ou onde quiser). Você começa pilotando.</p>
      <div class="row"><label>Meu banco</label>${seg('seat', [[0, 'esquerdo'], [1, 'direito']])}</div>
      <div class="row"><button class="go" data-a="mk">Criar convite</button><span class="st"></span></div>
      <div data-step2 hidden>
        <p><b>1.</b> Mande este link para a outra pessoa:</p>
        <textarea readonly data-link></textarea>
        <div class="row"><button class="go sec" data-a="copy">Copiar link</button></div>
        <p><b>2.</b> Ela abre o link, aceita e te manda um código de resposta. Cole aqui:</p>
        <textarea data-ans placeholder="código de resposta"></textarea>
        <div class="row"><button class="go" data-a="con">Conectar</button><span class="st" data-st2></span></div>
      </div>
      <p class="hint">Em voo: <kbd>T</kbd>/L3 solta ou pega os comandos · <kbd>B</kbd>/R3 (segurar) fala · <kbd>Enter</kbd> chat · <kbd>G</kbd> este painel</p>`);
    el.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { const k = s.dataset.k; c[k] = k === 'seat' ? +b.dataset.v : b.dataset.v; this.renderHost(); };
    }));
    el.querySelector('[data-a=mk]').onclick = async () => {
      const st = el.querySelector('.st'); st.textContent = 'preparando...';
      try {
        const link = await this.createInvite();
        el.querySelector('[data-link]').value = link;
        el.querySelector('[data-step2]').hidden = false;
        st.textContent = '';
      } catch (e) { st.textContent = 'erro: ' + e.message; }
    };
    el.querySelector('[data-a=copy]').onclick = () => { const t = el.querySelector('[data-link]'); t.select(); navigator.clipboard?.writeText(t.value); };
    el.querySelector('[data-a=con]').onclick = async () => {
      const st = el.querySelector('[data-st2]'); st.textContent = 'conectando...';
      try { await this.acceptAnswer(el.querySelector('[data-ans]').value); st.textContent = 'esperando a ligação...'; }
      catch (e) { st.textContent = 'código inválido: ' + e.message; }
    };
  }
  renderGuest() {
    const el = this.card('Convite de voo', `
      <p>Alguém te convidou para voar junto no mesmo avião.</p>
      <div class="row"><button class="go" data-a="ok">Aceitar (A / Espaço)</button><span class="st"></span></div>
      <div data-step2 hidden>
        <p>Mande este código de resposta para quem te convidou (ele cola no jogo dele):</p>
        <textarea readonly data-ans></textarea>
        <div class="row"><button class="go sec" data-a="copy">Copiar código (A / Espaço)</button><span class="st" data-st2>esperando a ligação...</span></div>
      </div>`);
    const ok = async () => {
      if (this.guestStep) return;
      this.guestStep = 1;
      const st = el.querySelector('.st'); st.textContent = 'preparando...';
      try {
        el.querySelector('[data-ans]').value = await this.acceptInvite(this.invite);
        el.querySelector('[data-step2]').hidden = false; st.textContent = '';
        this.guestStep = 2;
        copy();
      } catch (e) { st.textContent = 'convite inválido: ' + e.message; this.guestStep = 0; }
    };
    const copy = () => {
      const t = el.querySelector('[data-ans]'); t.select();
      navigator.clipboard?.writeText(t.value).then(() => { el.querySelector('[data-st2]').textContent = 'código copiado — cole no WhatsApp e mande'; }).catch(() => {});
    };
    el.querySelector('[data-a=ok]').onclick = ok;
    el.querySelector('[data-a=copy]').onclick = copy;
    this.guestOk = () => (this.guestStep === 2 ? copy() : ok());   // A / Espaco
  }
  renderConnected() {
    const el = this.card('Voando junto', `
      <p>Conectado. Você está no banco ${this.mySeat === 0 ? 'esquerdo' : 'direito'}.</p>
      <p class="hint"><kbd>T</kbd>/L3 solta ou pega os comandos · <kbd>B</kbd>/R3 (segurar) fala · <kbd>Enter</kbd> chat</p>
      <div class="row"><button class="go sec" data-a="off">Desconectar</button></div>`);
    el.querySelector('[data-a=off]').onclick = () => { this.hangup('Você desconectou.'); this.close(); };
  }

  // ---------- conexão ----------
  newPC(offerer) {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    this.pc = pc;
    // canal de voz criado ja na oferta (sem microfone ainda: ele entra no primeiro "falar", sem renegociar)
    if (offerer) this.audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.ontrack = (e) => this.remoteAudio(e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.hangup('A ligação caiu.');
    };
    return pc;
  }
  async gathered(pc) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((res) => {
      const t = setTimeout(res, 3000);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  wireData(dcState, dcCtl) {
    this.dcState = dcState; this.dcCtl = dcCtl;
    dcState.binaryType = 'arraybuffer';
    dcState.onmessage = (e) => {
      const b = new Uint8Array(e.data), w = this.w;
      new Uint8Array(w.memory.buffer, w.voo_net_buf(), b.length).set(b);
      w.voo_net_recv(b.length, performance.now() / 1000);
    };
    dcCtl.onmessage = (e) => this.onCtl(JSON.parse(e.data));
    let open = 0;
    const ready = () => { if (++open === 2) this.connected(); };
    if (dcState.readyState === 'open') ready(); else dcState.onopen = ready;
    if (dcCtl.readyState === 'open') ready(); else dcCtl.onopen = ready;
  }
  async createInvite() {
    const pc = this.newPC(true);
    this.host = true;
    const dcState = pc.createDataChannel('estado', { ordered: false, maxRetransmits: 0 });
    const dcCtl = pc.createDataChannel('ctl', { ordered: true });
    this.wireData(dcState, dcCtl);
    await pc.setLocalDescription(await pc.createOffer());
    await this.gathered(pc);
    const code = await packCode({ v: 1, sdp: pc.localDescription.sdp, seat: this.cfg.seat });
    return `${location.origin}${location.pathname}#convite=${code}`;
  }
  async acceptAnswer(code) {
    const a = await unpackCode(code);
    await this.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
  }
  async acceptInvite(code) {
    const o = await unpackCode(code);
    this.host = false;
    this.cfg = { seat: 1 - o.seat };
    this.hostSeat = o.seat;
    const pc = this.newPC(false);
    let got = {};
    pc.ondatachannel = (e) => { got[e.channel.label] = e.channel; if (got.estado && got.ctl) this.wireData(got.estado, got.ctl); };
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    this.audioTx = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
    if (this.audioTx) this.audioTx.direction = 'sendrecv';
    await pc.setLocalDescription(await pc.createAnswer());
    await this.gathered(pc);
    return packCode({ v: 1, sdp: pc.localDescription.sdp });
  }
  connected() {
    if (this.on) return;
    this.on = true;
    this.mySeat = this.cfg.seat;
    if (this.host) this.w.voo_net_start(1, this.mySeat, this.mySeat);   // quem convida começa pilotando
    else this.w.voo_net_start(0, this.mySeat, this.hostSeat);
    this.close();
    this.say(`Conectado. ${this.flying() ? 'Você está com os comandos.' : 'Os comandos estão com o outro.'}`, 4);
    this.addChat('', 'conectado: voando junto');
  }
  hangup(why) {
    if (!this.on && !this.pc) return;
    try { this.pc?.close(); } catch { /* */ }
    this.pc = null;
    if (this.on) { this.w.voo_net_stop(); this.say(why, 4); this.addChat('', why); }
    this.on = false;
    if (this.mic) { this.mic.getTracks().forEach((t) => t.stop()); this.mic = null; }
  }

  // ---------- comandos ----------
  flying() { const I = this.I; return I ? (I[101] | 0) === this.mySeat : true; }
  send(o) { if (this.dcCtl?.readyState === 'open') this.dcCtl.send(JSON.stringify(o)); }
  pressT() {
    if (!this.on || this.grabbing) return;
    if (this.flying()) { this.send({ t: 'release' }); this.say('Você soltou os comandos', 2.5); }
    else this.grab();
  }
  // pega os comandos: a mão vai ao manche (~0,35 s) e então este computador passa a calcular o avião
  grab() {
    if (this.grabbing || this.flying()) return;
    this.grabbing = true;
    this.cabin?.grab(this.mySeat);
    this.send({ t: 'grab' });
    setTimeout(() => {
      this.grabbing = false;
      if (!this.on || this.flying()) return;
      this.w.voo_net_take();
      this.send({ t: 'took' });
      this.say('Você está com os comandos', 2.5);
    }, 350);
  }
  onCtl(m) {
    if (m.t === 'release') this.grab();                                   // soltou: assume sem perguntar
    else if (m.t === 'grab') this.cabin?.grab(1 - this.mySeat);          // a mão do outro vai ao manche
    else if (m.t === 'took') { if (this.flying()) this.w.voo_net_give(); this.say('O outro está com os comandos', 2.5); }
    else if (m.t === 'chat') this.addChat('Outro', m.txt);
    else if (m.t === 'ptt') { this.squelch(); this.otherTalking = m.on; }
  }

  // ---------- voz (interfone) ----------
  async ptt(on) {
    if (!this.on || on === this.talking) return;
    this.talking = on;
    if (on && !this.mic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        await this.audioTx.sender.replaceTrack(this.mic.getAudioTracks()[0]);
      } catch (e) { this.say('Sem microfone: ' + e.message, 3); this.talking = false; return; }
    }
    if (this.mic) this.mic.getAudioTracks().forEach((t) => { t.enabled = this.talking; });
    this.send({ t: 'ptt', on: this.talking });
  }
  remoteAudio(stream) {
    // o Chrome só toca áudio remoto no Web Audio se ele também estiver num elemento de mídia
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    this.remoteEl = el;
    const ctx = this.sound.ctx;
    if (!ctx) { el.muted = false; return; }
    const src = ctx.createMediaStreamSource(stream);
    // som de fone de aviação: faixa de voz estreita e um pouco de saturação
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 320, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200, Q: 0.9 });
    const sh = new WaveShaperNode(ctx, { curve: Float32Array.from({ length: 256 }, (_, i) => Math.tanh((i / 127.5 - 1) * 2.2) / Math.tanh(2.2)) });
    const g = new GainNode(ctx, { gain: 1.4 * (this.sound.radio ?? 0.64) });
    src.connect(hp); hp.connect(lp); lp.connect(sh); sh.connect(g); g.connect(ctx.destination);
    this.voice = g;
    this.voiceTimer = setInterval(() => { g.gain.setTargetAtTime(1.4 * (this.sound.radio ?? 0.64), ctx.currentTime, 0.05); }, 250);   // volume do radio
  }
  squelch() {   // chiado curto do interfone ao apertar/soltar
    const ctx = this.sound.ctx;
    if (!ctx) return;
    const n = Math.floor(ctx.sampleRate * 0.06), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.12 * (1 - i / n);
    const s = new AudioBufferSourceNode(ctx, { buffer: b });
    const vg = new GainNode(ctx, { gain: this.sound.radio ?? 0.64 });
    const f = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2200, Q: 0.8 });
    s.connect(f); f.connect(vg); vg.connect(ctx.destination); s.start();
  }

  // ---------- chat e falas na tela ----------
  say(txt, secs = 5) {
    this.fala.textContent = txt;
    this.fala.style.opacity = 1;
    clearTimeout(this.falaT);
    this.falaT = setTimeout(() => { this.fala.style.opacity = 0; }, secs * 1000);
  }
  addChat(who, txt) {
    const d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = who ? `<b></b> ` : '<i></i>';
    if (who) { d.querySelector('b').textContent = who + ':'; d.append(txt); } else d.querySelector('i').textContent = txt;
    const input = this.chat.querySelector('input');
    this.chat.insertBefore(d, input);
    const msgs = this.chat.querySelectorAll('.msg');
    if (msgs.length > 6) msgs[0].remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 1200); }, 14000);
  }
  openChat() {
    if (!this.on || this.typing) return;
    this.typing = true;
    const inp = document.createElement('input');
    inp.placeholder = 'mensagem (Enter manda, Esc cancela)';
    this.chat.appendChild(inp);
    inp.focus();
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = inp.value.trim().slice(0, 200);
        if (t) { this.send({ t: 'chat', txt: t }); this.addChat('Você', t); }
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    };
    inp.onkeyup = (e) => e.stopPropagation();
  }
  closeChat() { this.typing = false; this.chat.querySelector('input')?.remove(); }

  // teclado: devolve true se a tecla é da rede (não vai para o jogo)
  key(e, down) {
    if (this.typing) return true;
    if (!this.panel.hidden) {   // painel aberto: as teclas sao dele (colar codigo etc.)
      if (down && e.key === 'Escape') this.close();
      if (down && !e.repeat && e.key === ' ' && this.guestOk && e.target?.tagName !== 'TEXTAREA') { e.preventDefault(); this.guestOk(); }
      return true;
    }
    const k = e.key.toLowerCase();
    if (k === 'g') { if (down && !e.repeat) this.open(); return true; }
    if (!this.on) return false;
    if (k === 't') { if (down && !e.repeat) this.pressT(); return true; }
    if (k === 'b') { if (!e.repeat) this.ptt(down); return true; }
    if (e.key === 'Enter' && down && !this.I?.[38]) { this.openChat(); return true; }
    return false;
  }

  // ---------- a cada quadro ----------
  tick(I, t) {
    this.I = I;
    if (this.invite && !this.on && !this.askedInvite) { this.askedInvite = true; this.open(); }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (gp && !this.panel.hidden && this.guestOk) {   // convite: A aceita / copia
      const a = !!gp.buttons[0]?.pressed;
      if (a && !this.padA) this.guestOk();
      this.padA = a;
    }
    if (gp && this.on) {
      const l3 = !!gp.buttons[10]?.pressed, r3 = !!gp.buttons[11]?.pressed;
      if (l3 && !this.padPrev[0]) this.pressT();
      if (r3 !== this.padPrev[1]) this.ptt(r3);
      this.padPrev = [l3, r3];
    }
    if (!this.on) { this.badge.hidden = true; return; }
    // retratos: quem pilota manda 20/s; o outro (se for quem convidou) manda só o relógio 2/s
    const flying = this.flying();
    const every = flying ? 1 / SEND_HZ : (this.host ? 0.5 : 1e9);
    if (t - this.lastSend >= every && this.dcState?.readyState === 'open' && this.dcState.bufferedAmount < 64 * 1024) {
      this.lastSend = t;
      const n = this.w.voo_net_pack(t);
      this.dcState.send(new Uint8Array(this.w.memory.buffer, this.w.voo_net_buf(), n).slice());
    }
    const fly = I[101] | 0;
    const seatName = (s) => (s === 0 ? 'esquerdo' : 'direito');
    this.badge.hidden = false;
    this.badge.innerHTML = `✈ Juntos · você: banco ${seatName(this.mySeat)}<br>`
      + `Comandos: <b>${fly === this.mySeat ? 'você' : 'o outro (banco ' + seatName(fly) + ')'}</b>`
      + (this.talking ? ' · <span class="mic">● falando</span>' : this.otherTalking ? ' · <span class="mic">● o outro fala</span>' : '');
  }
}
