(() => {
  'use strict';

  const CANONICAL_STORAGE_KEY = 'fluid_glass_material_config';
  const QUALITY_VALUES = ['auto', 'high', 'balanced', 'eco', 'fallback'];
  const PRESETS = {
    cyan: { a: '#00e7d2', b: '#3cc8ff', c: '#075f68' },
    original: { a: '#ff3aa7', b: '#ff8050', c: '#a443ff' },
    klein: { a: '#3158ff', b: '#ff6531', c: '#20252e' },
    chrome: { a: '#eef2f3', b: '#6c7780', c: '#11171d' }
  };
  const DEFAULT_CARD_VARIANTS = [
    { speed: .92, intensity: 1.02, pointer: .82, surface: .08, seed: 1.7 },
    { speed: .84, intensity: 1.08, pointer: .80, surface: .08, seed: 4.9 },
    { speed: .76, intensity: .98, pointer: .72, surface: .08, seed: 8.4 },
    { speed: .88, intensity: 1.05, pointer: .86, surface: .08, seed: 12.1 }
  ];

  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const clamp = (n, a, b) => { n = Number(n); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : a; };
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hexOk = (value) => /^#[0-9a-f]{6}$/i.test(value || '');
  const safeHex = (value, fallback) => hexOk(value) ? value.toLowerCase() : fallback;
  const slugKey = (value, index) => {
    const candidate = String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return candidate || `card-${String(index + 1).padStart(2, '0')}`;
  };
  const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);

  function defaultCards(count = 4) {
    return Array.from({ length: count }, (_, index) => {
      const variant = DEFAULT_CARD_VARIANTS[index % DEFAULT_CARD_VARIANTS.length];
      return {
        key: `card-${String(index + 1).padStart(2, '0')}`,
        label: `Metric ${String(index + 1).padStart(2, '0')}`,
        eyebrow: `SIGNAL ${String(index + 1).padStart(2, '0')}`,
        value: String([12, 28, 56, 3][index % 4]),
        unit: 'units',
        change: [20, 8, 15, -40][index % 4],
        preset: 'cyan',
        ...PRESETS.cyan,
        ...variant,
        chart: { enabled: false }
      };
    });
  }

  const DEFAULTS = {
    storageKey: CANONICAL_STORAGE_KEY,
    quality: 'auto',
    interaction: true,
    cards: defaultCards(4)
  };

  function normalizeCard(card, index) {
    const variant = DEFAULT_CARD_VARIANTS[index % DEFAULT_CARD_VARIANTS.length];
    const base = defaultCards(index + 1)[index];
    const palette = PRESETS[card?.preset] || PRESETS.cyan;
    return {
      ...base,
      ...variant,
      ...(card || {}),
      key: slugKey(card?.key, index),
      label: String(card?.label ?? base.label),
      eyebrow: String(card?.eyebrow ?? base.eyebrow),
      value: String(card?.value ?? base.value),
      unit: String(card?.unit ?? base.unit),
      change: Number.isFinite(Number(card?.change)) ? Number(card.change) : base.change,
      preset: typeof card?.preset === 'string' ? card.preset : 'cyan',
      a: safeHex(card?.a, palette.a),
      b: safeHex(card?.b, palette.b),
      c: safeHex(card?.c, palette.c),
      speed: clamp(Number(card?.speed ?? variant.speed), 0, 2),
      intensity: clamp(Number(card?.intensity ?? variant.intensity), .35, 1.6),
      pointer: clamp(Number(card?.pointer ?? variant.pointer), 0, 1.5),
      surface: clamp(Number(card?.surface ?? variant.surface), 0, 1),
      seed: Number.isFinite(Number(card?.seed)) ? Number(card.seed) : variant.seed,
      chart: { enabled: Boolean(card?.chart?.enabled) }
    };
  }

  function mergeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const cards = Array.isArray(source.cards) && source.cards.length ? source.cards : DEFAULTS.cards;
    const unique = new Set();
    const normalizedCards = cards.slice(0, 12).map(normalizeCard).map((card, index) => {
      let key = card.key;
      let n = index + 1;
      while (unique.has(key)) key = `${card.key}-${++n}`;
      unique.add(key);
      return { ...card, key };
    });
    return {
      storageKey: typeof source.storageKey === 'string' && source.storageKey.trim() ? source.storageKey.trim() : CANONICAL_STORAGE_KEY,
      quality: QUALITY_VALUES.includes(source.quality) ? source.quality : 'auto',
      interaction: typeof source.interaction === 'boolean' ? source.interaction : true,
      cards: normalizedCards
    };
  }

  function loadSettings(seedConfig) {
    const base = mergeSettings(seedConfig || window.FLUID_GLASS_CONFIG || DEFAULTS);
    try {
      const saved = localStorage.getItem(base.storageKey);
      return saved ? mergeSettings({ ...base, ...JSON.parse(saved) }) : base;
    } catch (_) {
      return base;
    }
  }

  let settings = loadSettings();

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }
  function mixRgb(from, to, t) {
    const a = hexToRgb(from), b = hexToRgb(to);
    return `rgb(${a.map((v, i) => Math.round((v + (b[i] - v) * t) * 255)).join(',')})`;
  }
  function materialTokens(surface) {
    const s = clamp(surface, 0, 1);
    const light = smoothstep(.25, .46, s);
    return {
      surface: s.toFixed(3),
      shade: (.48 * Math.pow(1 - s, 1.45)).toFixed(3),
      shadeMid: (.3456 * Math.pow(1 - s, 1.45)).toFixed(3),
      shadeSoft: (.1536 * Math.pow(1 - s, 1.45)).toFixed(3),
      topGlow: (.035 * (1 - s)).toFixed(3),
      bottomShade: (.10 * (1 - s)).toFixed(3),
      text: mixRgb('#f3fffb', '#16201d', light),
      title: mixRgb('#d8eee8', '#2b3632', light),
      muted: mixRgb('#8fa9a2', '#59635f', light),
      eyebrow: mixRgb('#82a69d', '#66716c', light),
      change: mixRgb('#819b94', '#59645f', light),
      edge: (.10 + .22 * s).toFixed(3),
      light
    };
  }
  function surfaceLabel(value) {
    const p = Math.round(value * 100);
    if (p === 0) return '0% · transparent';
    if (p < 20) return `${p}% · glass`;
    if (p < 55) return `${p}% · gray glass`;
    if (p < 100) return `${p}% · bright material`;
    return '100% · white';
  }
  function qualityProfile(requested) {
    const query = new URLSearchParams(location.search).get('fluid');
    if (query === 'fallback') return { name: 'fallback', fps: 0, dpr: 1 };
    if (query === 'eco') requested = 'eco';
    if (requested === 'fallback') return { name: 'fallback', fps: 0, dpr: 1 };
    if (requested === 'high') return { name: 'high', fps: 60, dpr: Math.min(devicePixelRatio || 1, 1.8) };
    if (requested === 'balanced') return { name: 'balanced', fps: 45, dpr: Math.min(devicePixelRatio || 1, 1.35) };
    if (requested === 'eco') return { name: 'eco', fps: 24, dpr: Math.min(devicePixelRatio || 1, 1) };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const lowCpu = (navigator.hardwareConcurrency || 8) <= 4;
    const lowMemory = (navigator.deviceMemory || 8) <= 4;
    if (reduced || saveData || lowCpu || lowMemory) return { name: 'eco', fps: reduced ? 15 : 24, dpr: Math.min(devicePixelRatio || 1, 1) };
    return { name: 'balanced', fps: 45, dpr: Math.min(devicePixelRatio || 1, 1.35) };
  }

  const VERTEX_SHADER = `    attribute vec2 a_position;
    varying vec2 v_uv;
    void main(){
      v_uv=a_position*.5+.5;
      gl_Position=vec4(a_position,0.0,1.0);
    }
  
`;
  const FRAGMENT_SHADER = `    precision highp float;
    varying vec2 v_uv;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform vec2 u_mouseVelocity;
    uniform float u_mouseMix;
    uniform float u_time;
    uniform float u_speed;
    uniform float u_intensity;
    uniform float u_pointer;
    uniform float u_seed;
    uniform float u_surfaceOpacity;
    uniform vec3 u_colorA;
    uniform vec3 u_colorB;
    uniform vec3 u_colorC;

    float hash(vec2 p){
      p=fract(p*vec2(123.34,456.21));
      p+=dot(p,p+45.32);
      return fract(p.x*p.y);
    }
    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p);
      f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);
    }
    float fbm(vec2 p){
      float value=0.0;
      float amp=.53;
      mat2 rot=mat2(.80,-.60,.60,.80);
      for(int i=0;i<5;i++){
        value+=amp*noise(p);
        p=rot*p*2.02+vec2(17.13,9.27);
        amp*=.49;
      }
      return value;
    }
    float softBlob(vec2 p,vec2 center,float radius,float softness){
      return 1.0-smoothstep(radius-softness,radius+softness,length(p-center));
    }
    void main(){
      vec2 uv=v_uv;
      float aspect=u_resolution.x/max(1.0,u_resolution.y);
      vec2 p=(uv-.5)*vec2(aspect,1.0);
      vec2 mouse=(u_mouse-.5)*vec2(aspect,1.0);
      vec2 delta=p-mouse;
      float dist=length(delta);
      float mouseField=exp(-dist*dist*7.2)*u_mouseMix*u_pointer;
      vec2 normal=delta/max(dist,.035);
      vec2 tangent=vec2(-normal.y,normal.x);
      p+=normal*mouseField*.115+tangent*mouseField*(u_mouseVelocity.x-u_mouseVelocity.y)*.045;

      float t=u_time*u_speed;
      vec2 seedVec=vec2(u_seed*1.713,u_seed*.937);
      float w1=fbm(p*1.22+seedVec+vec2(t*.075,-t*.052));
      float w2=fbm(p*1.54-seedVec*.37+vec2(-t*.057,t*.064)+w1*.82);
      vec2 q=p+(vec2(w1,w2)-.5)*(.58*u_intensity);
      float broad=fbm(q*1.12+vec2(t*.041,-t*.033));
      float detail=fbm(q*2.18+vec2(-t*.083,t*.057)+broad*.95);
      float ribbon=.5+.5*sin(q.x*3.15+q.y*.76+detail*5.0+t*.25+u_seed);
      float colorMix=smoothstep(.16,.88,broad*.61+ribbon*.39);
      vec3 fluid=mix(u_colorA,u_colorB,colorMix);
      float shadow=smoothstep(.43,.84,detail*.69+(.5+.5*sin(q.y*4.2-q.x*.8-t*.17))*.31);
      fluid=mix(fluid,u_colorC,shadow*.74);

      float plume1=softBlob(p,vec2(aspect*.23+.12*sin(t*.08+u_seed),.16*cos(t*.11+u_seed)),.52,.38);
      float plume2=softBlob(p,vec2(aspect*.39+.10*cos(t*.07-u_seed),-.24+.11*sin(t*.09)),.43,.34);
      float haze=clamp(plume1*.72+plume2*.58,0.0,1.0);
      float reveal=smoothstep(.055,.735,uv.x+(.5-broad)*.27+.070*sin(uv.y*4.0+t*.12));
      reveal*=mix(.70,1.0,haze);
      reveal=clamp(reveal*u_intensity,0.0,1.0);

      float spec=pow(clamp(1.0-abs(detail-.52)*2.0,0.0,1.0),5.0)*reveal;
      float caustic=pow(clamp(.52+.48*sin((q.x-q.y)*5.2+detail*7.0-t*.18),0.0,1.0),7.0)*reveal;
      vec3 cyanGlow=mix(fluid,vec3(.34,1.0,.90),spec*.18+caustic*.09);
      cyanGlow*=.78+.25*haze;
      cyanGlow=mix(cyanGlow,cyanGlow*.70,u_surfaceOpacity*.34);
      float filament=smoothstep(.48,.86,detail)*reveal;
      float density=clamp(reveal*(.36+.48*haze)+filament*.22+mouseField*.28,0.0,1.0);
      float alpha=clamp(.035*haze+density*(.24+.50*u_intensity)+spec*.08+u_surfaceOpacity*density*.14,0.0,.92);
      float edgeFade=smoothstep(1.08,.70,length((uv-.5)*vec2(1.0,.92)));
      alpha*=edgeFade;
      cyanGlow=pow(max(cyanGlow,0.0),vec3(.94));
      gl_FragColor=vec4(cyanGlow,alpha);
    }
  
`;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Shader compile failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }
  function buildProgram(gl) {
    const program = gl.createProgram();
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return program;
  }

  let liveContexts = 0;
  const MAX_CONTEXTS = 8;

  class FluidGlassRenderer {
    constructor(element, config, index, manager) {
      this.element = element;
      this.key = config.key;
      this.index = index;
      this.manager = manager;
      this.canvas = element.querySelector('.fg-fluid-canvas');
      this.config = config;
      this.gl = null;
      this.program = null;
      this.buffer = null;
      this.uniforms = {};
      this.active = true;
      this.failed = false;
      this.lastFrame = 0;
      this.mouse = [.76, .46];
      this.mouseTarget = [.76, .46];
      this.mouseVelocity = [0, 0];
      this.mouseMix = 0;
      this.pointerInside = false;
      this.controller = new AbortController();
      this.bindPointer();
      this.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.fallback('WebGL context lost'); }, { signal: this.controller.signal });
      this.canvas.addEventListener('webglcontextrestored', () => { this.destroyGl(); this.failed = false; this.init(); }, { signal: this.controller.signal });
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(element);
      this.intersectionObserver = new IntersectionObserver((entries) => { this.active = entries[0]?.isIntersecting !== false; }, { rootMargin: '80px' });
      this.intersectionObserver.observe(element);
      this.applyCssPalette();
    }
    bindPointer() {
      const signal = this.controller.signal;
      let last = [0, 0], lastT = 0;
      const update = (event) => {
        if (!settings.interaction) return;
        const rect = this.element.getBoundingClientRect();
        const x = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
        const y = clamp(1 - (event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
        const now = performance.now(), dt = Math.max(8, now - lastT || 16);
        this.mouseTarget = [x, y];
        this.mouseVelocity = [clamp((x - last[0]) / (dt / 16.67), -.12, .12), clamp((y - last[1]) / (dt / 16.67), -.12, .12)];
        last = [x, y];
        lastT = now;
        this.mouseMix = 1;
      };
      this.element.addEventListener('pointerenter', (event) => { this.pointerInside = true; update(event); }, { signal, passive: true });
      this.element.addEventListener('pointermove', update, { signal, passive: true });
      this.element.addEventListener('pointerleave', () => { this.pointerInside = false; this.mouseTarget = [.76, .46]; }, { signal, passive: true });
      this.element.addEventListener('pointerdown', (event) => { this.mouseMix = 1.2; update(event); }, { signal, passive: true });
    }
    init() {
      const profile = this.manager.profile;
      if (profile.name === 'fallback') return this.fallback('CSS fallback mode');
      if (liveContexts >= MAX_CONTEXTS) return this.fallback('WebGL context budget reached');
      try {
        const gl = this.canvas.getContext('webgl', {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: profile.name === 'eco' ? 'low-power' : 'high-performance'
        });
        if (!gl) throw new Error('WebGL context unavailable');
        this.gl = gl;
        liveContexts++;
        gl.clearColor(0, 0, 0, 0);
        this.program = buildProgram(gl);
        gl.useProgram(this.program);
        const buffer = gl.createBuffer();
        this.buffer = buffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const pos = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
        ['u_resolution','u_mouse','u_mouseVelocity','u_mouseMix','u_time','u_speed','u_intensity','u_pointer','u_seed','u_surfaceOpacity','u_colorA','u_colorB','u_colorC'].forEach((name) => { this.uniforms[name] = gl.getUniformLocation(this.program, name); });
        this.failed = false;
        this.element.classList.remove('is-fallback');
        this.resize();
        return true;
      } catch (error) {
        console.warn(`[FluidGlass:${this.key}]`, error);
        this.fallback(error.message);
        return false;
      }
    }
    fallback(reason) { this.failed = true; this.destroyGl(); this.element.classList.add('is-fallback'); this.fallbackReason = reason; return false; }
    destroyGl() {
      const gl = this.gl;
      if (gl) {
        try { if (this.program) gl.deleteProgram(this.program); } catch (_) {}
        try { if (this.buffer) gl.deleteBuffer(this.buffer); } catch (_) {}
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (_) {}
        liveContexts = Math.max(0, liveContexts - 1);
      }
      this.gl = null; this.program = null; this.buffer = null;
    }
    destroy() { this.resizeObserver.disconnect(); this.intersectionObserver.disconnect(); this.controller.abort(); this.destroyGl(); }
    setProfile() { const shouldFallback = this.manager.profile.name === 'fallback'; if (shouldFallback) { this.fallback('CSS fallback mode'); return; } if (!this.gl) { this.failed = false; this.element.classList.remove('is-fallback'); this.init(); } else this.resize(); }
    setConfig(config) { this.config = config; this.applyCssPalette(); }
    applyCssPalette() {
      const t = materialTokens(this.config.surface);
      const style = this.element.style;
      style.setProperty('--fluid-a', this.config.a);
      style.setProperty('--fluid-b', this.config.b);
      style.setProperty('--fluid-c', this.config.c);
      style.setProperty('--surface-opacity', t.surface);
      style.setProperty('--content-shade', t.shade);
      style.setProperty('--content-shade-mid', t.shadeMid);
      style.setProperty('--content-shade-soft', t.shadeSoft);
      style.setProperty('--top-glow', t.topGlow);
      style.setProperty('--bottom-shade', t.bottomShade);
      style.setProperty('--stat-text', t.text);
      style.setProperty('--stat-title', t.title);
      style.setProperty('--stat-muted', t.muted);
      style.setProperty('--stat-eyebrow', t.eyebrow);
      style.setProperty('--stat-change', t.change);
      style.setProperty('--edge-highlight', t.edge);
      this.element.dataset.surfaceTone = t.light > .5 ? 'light' : 'dark';
    }
    resize() {
      if (!this.gl) return;
      const rect = this.element.getBoundingClientRect();
      const dpr = this.manager.profile.dpr;
      const width = Math.max(2, Math.round(rect.width * dpr));
      const height = Math.max(2, Math.round(rect.height * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }
    }
    render(now) {
      if (!this.gl || !this.active || document.hidden) return false;
      const interval = 1000 / this.manager.profile.fps;
      if (now - this.lastFrame < interval) return false;
      this.lastFrame = now;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.mouse[0] += (this.mouseTarget[0] - this.mouse[0]) * .105;
      this.mouse[1] += (this.mouseTarget[1] - this.mouse[1]) * .105;
      this.mouseVelocity[0] *= .90;
      this.mouseVelocity[1] *= .90;
      this.mouseMix += ((this.pointerInside && settings.interaction ? 1 : 0) - this.mouseMix) * .075;
      if (!this.pointerInside) this.mouseMix *= .945;
      const gl = this.gl, c = this.config;
      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
      gl.uniform2f(this.uniforms.u_mouse, this.mouse[0], this.mouse[1]);
      gl.uniform2f(this.uniforms.u_mouseVelocity, this.mouseVelocity[0], this.mouseVelocity[1]);
      gl.uniform1f(this.uniforms.u_mouseMix, settings.interaction ? clamp(this.mouseMix, 0, 1.2) : 0);
      gl.uniform1f(this.uniforms.u_time, (now * .001) + (this.index * 3.73));
      gl.uniform1f(this.uniforms.u_speed, reduced ? Math.min(c.speed, .08) : c.speed);
      gl.uniform1f(this.uniforms.u_intensity, c.intensity);
      gl.uniform1f(this.uniforms.u_pointer, c.pointer);
      gl.uniform1f(this.uniforms.u_seed, c.seed);
      gl.uniform1f(this.uniforms.u_surfaceOpacity, c.surface);
      gl.uniform3fv(this.uniforms.u_colorA, hexToRgb(c.a));
      gl.uniform3fv(this.uniforms.u_colorB, hexToRgb(c.b));
      gl.uniform3fv(this.uniforms.u_colorC, hexToRgb(c.c));
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    }
    status() { return { key: this.key, mode: this.gl ? 'webgl' : 'fallback', reason: this.fallbackReason || '', canvas: [this.canvas.width, this.canvas.height], palette: { a: this.config.a, b: this.config.b, c: this.config.c }, surface: this.config.surface }; }
  }

  class FluidGlassManager {
    constructor() {
      this.profile = qualityProfile(settings.quality);
      this.renderers = [];
      this.running = true;
      document.querySelectorAll('[data-fluid-glass-key]').forEach((element, index) => {
        const key = element.dataset.fluidGlassKey;
        const config = settings.cards.find((card) => card.key === key);
        if (!config) return;
        const renderer = new FluidGlassRenderer(element, config, index, this);
        this.renderers.push(renderer);
        renderer.init();
      });
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
      this.onVisibilityChange = () => { if (!document.hidden) this.renderers.forEach((renderer) => renderer.resize()); };
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    loop(now) { if (this.running) this.renderers.forEach((renderer) => renderer.render(now)); this.raf = requestAnimationFrame(this.loop); }
    byKey(key) { return this.renderers.find((renderer) => renderer.key === key); }
    refresh(key) { const renderer = this.byKey(key); const card = settings.cards.find((item) => item.key === key); if (renderer && card) renderer.setConfig(card); }
    refreshAll() { this.renderers.forEach((renderer) => { const card = settings.cards.find((item) => item.key === renderer.key); if (card) renderer.setConfig(card); }); this.setQuality(settings.quality); }
    setQuality(value) { settings.quality = value; this.profile = qualityProfile(value); this.renderers.forEach((renderer) => renderer.setProfile()); updateDiagnostic(); }
    status() { return { requestedQuality: settings.quality, resolvedQuality: this.profile.name, interaction: settings.interaction, cards: this.renderers.map((renderer) => renderer.status()) }; }
    destroy() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; document.removeEventListener('visibilitychange', this.onVisibilityChange); this.renderers.forEach((renderer) => renderer.destroy()); this.renderers = []; }
  }

  function cardMarkup(card) {
    const signClass = card.change >= 0 ? 'fg-change-positive' : 'fg-change-negative';
    const sign = card.change >= 0 ? '↑' : '↓';
    return `<article class="fg-card" data-fluid-glass-key="${escapeHtml(card.key)}" data-chart-enabled="${card.chart.enabled}">
      <canvas class="fg-fluid-canvas" aria-hidden="true"></canvas>
      <div class="fg-noise" aria-hidden="true"></div>
      <div class="fg-content">
        <div class="fg-eyebrow">${escapeHtml(card.eyebrow)}</div>
        <div class="fg-title">${escapeHtml(card.label)}</div>
        <div><span class="fg-value">${escapeHtml(card.value)}</span><span class="fg-unit">${escapeHtml(card.unit)}</span></div>
        <div class="fg-change"><span class="${signClass}">${sign} ${Math.abs(card.change)}%</span></div>
      </div>
      <canvas class="fg-chart" aria-hidden="true"></canvas>
      <div class="fg-fluid-fallback" aria-hidden="true"></div>
    </article>`;
  }

  const grid = document.getElementById('fluidGlassGrid');
  if (!grid) throw new Error('Missing #fluidGlassGrid');
  grid.innerHTML = settings.cards.map(cardMarkup).join('');

  const manager = new FluidGlassManager();
  let selectedKey = settings.cards[0].key;
  const panel = document.getElementById('fluidGlassPanel');
  const backdrop = document.getElementById('fluidGlassBackdrop');
  const cardSelect = document.getElementById('fluidGlassCardSelect');
  const inputs = {
    a: document.getElementById('fluidGlassColorA'),
    b: document.getElementById('fluidGlassColorB'),
    c: document.getElementById('fluidGlassColorC'),
    speed: document.getElementById('fluidGlassSpeed'),
    intensity: document.getElementById('fluidGlassIntensity'),
    pointer: document.getElementById('fluidGlassPointer'),
    surface: document.getElementById('fluidGlassSurface')
  };
  const outputs = {
    a: document.getElementById('fluidGlassColorAText'),
    b: document.getElementById('fluidGlassColorBText'),
    c: document.getElementById('fluidGlassColorCText'),
    speed: document.getElementById('fluidGlassSpeedValue'),
    intensity: document.getElementById('fluidGlassIntensityValue'),
    pointer: document.getElementById('fluidGlassPointerValue'),
    surface: document.getElementById('fluidGlassSurfaceValue')
  };
  const preview = document.getElementById('fluidGlassPreview');
  const previewName = document.getElementById('fluidGlassPreviewName');
  const qualitySelect = document.getElementById('fluidGlassQuality');
  const interaction = document.getElementById('fluidGlassInteraction');

  let saveTimer = 0;
  function persistSettings() {
    try {
      localStorage.setItem(settings.storageKey, JSON.stringify(settings));
    } catch (error) {
      console.warn('[FluidGlass:storage]', error);
    }
  }
  function saveSettings(notify = false) {
    clearTimeout(saveTimer);
    if (notify) { persistSettings(); showToast('Settings saved'); return; }
    saveTimer = setTimeout(persistSettings, 200);
  }
  function showToast(message) {
    const el = document.getElementById('fluidGlassToast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove('show'), 1850);
  }
  function updateDiagnostic() {
    const el = document.getElementById('fluidGlassDiagnostic');
    if (!el) return;
    const count = manager.renderers.filter((renderer) => !!renderer.gl).length;
    el.classList.toggle('ok', count === manager.renderers.length);
    el.classList.toggle('warn', count < manager.renderers.length);
    const mode = manager.profile.name === 'fallback' ? 'CSS fallback' : `${manager.profile.name} · ${count}/${manager.renderers.length} WebGL`;
    el.querySelector('span').textContent = mode;
  }
  function selectedCard() { return settings.cards.find((card) => card.key === selectedKey); }
  function selectCard(key) {
    if (!settings.cards.some((card) => card.key === key)) key = settings.cards[0].key;
    selectedKey = key;
    if (cardSelect) cardSelect.value = key;
    document.querySelectorAll('[data-fluid-glass-key]').forEach((element) => element.classList.toggle('is-selected', element.dataset.fluidGlassKey === key));
    syncPanel();
  }
  function syncPanel() {
    if (!cardSelect || !inputs.a) return;
    const card = selectedCard();
    inputs.a.value = card.a;
    inputs.b.value = card.b;
    inputs.c.value = card.c;
    inputs.speed.value = card.speed;
    inputs.intensity.value = card.intensity;
    inputs.pointer.value = card.pointer;
    inputs.surface.value = Math.round(card.surface * 100);
    outputs.a.textContent = card.a.toUpperCase();
    outputs.b.textContent = card.b.toUpperCase();
    outputs.c.textContent = card.c.toUpperCase();
    outputs.speed.textContent = `${card.speed.toFixed(2)}×`;
    outputs.intensity.textContent = `${Math.round(card.intensity * 100)}%`;
    outputs.pointer.textContent = `${Math.round(card.pointer * 100)}%`;
    outputs.surface.textContent = surfaceLabel(card.surface);
    const mt = materialTokens(card.surface);
    preview.style.setProperty('--preview-a', card.a);
    preview.style.setProperty('--preview-b', card.b);
    preview.style.setProperty('--preview-c', card.c);
    preview.style.setProperty('--preview-surface', mt.surface);
    preview.style.setProperty('--preview-shade', mt.shade);
    preview.style.setProperty('--preview-shade-mid', mt.shadeMid);
    preview.style.setProperty('--preview-text', mt.text);
    preview.style.setProperty('--preview-muted', mt.muted);
    previewName.textContent = card.label;
    qualitySelect.value = settings.quality;
    interaction.checked = settings.interaction;
    document.querySelectorAll('[data-fluid-glass-preset]').forEach((button) => button.classList.toggle('active', button.dataset.fluidGlassPreset === card.preset));
    updateDiagnostic();
  }
  function applyInputs() {
    const card = selectedCard();
    card.a = inputs.a.value;
    card.b = inputs.b.value;
    card.c = inputs.c.value;
    card.speed = Number(inputs.speed.value);
    card.intensity = Number(inputs.intensity.value);
    card.pointer = Number(inputs.pointer.value);
    card.surface = clamp(Number(inputs.surface.value) / 100, 0, 1);
    card.preset = 'custom';
    manager.refresh(selectedKey);
    syncPanel();
    saveSettings(false);
  }
  function openPanel(key = selectedKey) {
    selectCard(key);
    backdrop.hidden = false;
    backdrop.classList.add('is-open');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
  }
  function closePanel() {
    panel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    setTimeout(() => { backdrop.hidden = true; }, 240);
    document.querySelectorAll('.fg-card').forEach((element) => element.classList.remove('is-selected'));
  }
  function resetSelected() {
    const index = settings.cards.findIndex((card) => card.key === selectedKey);
    const preserved = { key: settings.cards[index].key, label: settings.cards[index].label, eyebrow: settings.cards[index].eyebrow, value: settings.cards[index].value, unit: settings.cards[index].unit, change: settings.cards[index].change };
    settings.cards[index] = { ...normalizeCard(preserved, index), ...preserved };
    manager.refresh(selectedKey);
    syncPanel();
    saveSettings(false);
    showToast('Card material restored');
  }
  function applyMaterialToAll() {
    const source = selectedCard();
    settings.cards.forEach((card) => Object.assign(card, { a: source.a, b: source.b, c: source.c, surface: source.surface, preset: 'custom' }));
    manager.refreshAll();
    syncPanel();
    saveSettings(false);
    showToast('Material applied to all cards');
  }
  function exportHtml() {
    const snapshot = clone(settings);
    const bootstrap = `<script>window.FLUID_GLASS_CONFIG=${JSON.stringify(snapshot).replace(/</g, '\\u003c')};<\/script>`;
    const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML.replace('</head>', `${bootstrap}</head>`);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fluid-glass-interface.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  }

  if (cardSelect) {
    cardSelect.innerHTML = settings.cards.map((card) => `<option value="${escapeHtml(card.key)}">${escapeHtml(card.label)}</option>`).join('');
  }
  document.getElementById('fluidGlassSettingsButton')?.addEventListener('click', () => openPanel());
  document.getElementById('fluidGlassPanelClose')?.addEventListener('click', closePanel);
  backdrop?.addEventListener('click', closePanel);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.classList.contains('is-open')) closePanel(); });
  cardSelect?.addEventListener('change', () => selectCard(cardSelect.value));
  Object.values(inputs).forEach((input) => input?.addEventListener('input', applyInputs));
  document.querySelectorAll('[data-fluid-glass-preset]').forEach((button) => button.addEventListener('click', () => {
    const name = button.dataset.fluidGlassPreset;
    const card = selectedCard();
    Object.assign(card, PRESETS[name], { preset: name });
    manager.refresh(selectedKey);
    syncPanel();
    saveSettings(false);
  }));
  qualitySelect?.addEventListener('change', () => { manager.setQuality(qualitySelect.value); saveSettings(false); });
  interaction?.addEventListener('change', () => { settings.interaction = interaction.checked; saveSettings(false); });
  document.getElementById('fluidGlassResetCard')?.addEventListener('click', resetSelected);
  document.getElementById('fluidGlassApplyAll')?.addEventListener('click', applyMaterialToAll);
  document.getElementById('fluidGlassSaveSettings')?.addEventListener('click', () => { saveSettings(true); closePanel(); });
  document.getElementById('fluidGlassExport')?.addEventListener('click', exportHtml);

  selectCard(selectedKey);
  updateDiagnostic();
  setTimeout(updateDiagnostic, 300);

  window.FluidGlassMaterial = {
    getConfig: () => clone(settings),
    getStatus: () => manager.status(),
    openSettings: openPanel,
    closeSettings: closePanel,
    save: () => saveSettings(true),
    exportHtml,
    pause: () => { manager.running = false; },
    resume: () => { manager.running = true; },
    setQuality: (value) => { if (QUALITY_VALUES.includes(value)) { manager.setQuality(value); qualitySelect.value = value; saveSettings(false); } },
    setPalette: (key, preset) => { const card = settings.cards.find((item) => item.key === key); if (card && PRESETS[preset]) { Object.assign(card, PRESETS[preset], { preset }); manager.refresh(key); if (key === selectedKey) syncPanel(); } },
    setColors: (key, a, b, c) => { const card = settings.cards.find((item) => item.key === key); if (card) { card.a = safeHex(a, card.a); card.b = safeHex(b, card.b); card.c = safeHex(c, card.c); card.preset = 'custom'; manager.refresh(key); if (key === selectedKey) syncPanel(); } },
    setSurface: (key, value) => { const card = settings.cards.find((item) => item.key === key); if (card) { card.surface = clamp(Number(value), 0, 1); manager.refresh(key); if (key === selectedKey) syncPanel(); } },
    setMotion: (key, patch) => { const card = settings.cards.find((item) => item.key === key); if (card) { if (patch.speed != null) card.speed = clamp(Number(patch.speed), 0, 2); if (patch.intensity != null) card.intensity = clamp(Number(patch.intensity), .35, 1.6); if (patch.pointer != null) card.pointer = clamp(Number(patch.pointer), 0, 1.5); manager.refresh(key); if (key === selectedKey) syncPanel(); } }
  };
})();
