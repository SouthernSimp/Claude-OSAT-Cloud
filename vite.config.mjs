import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { validateLocalChatPayload, isLoopbackOrigin } from './src/local-ai.js';

const LOCAL_AI_UPSTREAM = 'http://127.0.0.1:1234';
const LOCAL_AI_MAX_BODY = 128 * 1024;
const LOCAL_AI_MAX_TOKENS = 2048;

function localAiApi() {
  return {
    name: 'local-ai-api',
    configureServer(server) {
      server.middlewares.use('/api/local-ai', async (req, res) => {
        const origin = req.headers.origin;
        if (!isLoopbackOrigin(origin)) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Local AI accepts loopback browser origins only.' }));
        }
        const path = req.url || '/';
        if (req.method === 'GET' && path === '/models') {
          try {
            const upstream = await fetch(`${LOCAL_AI_UPSTREAM}/api/v0/models`);
            const body = await upstream.json();
            res.statusCode = upstream.ok ? 200 : 503;
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify(upstream.ok
              ? { runtime: 'lm-studio', offline: true, models: (body.data || []).filter((model) => model.type === 'llm' && model.state === 'loaded').map((model) => ({ id: model.id, name: model.id === 'osat-local' ? 'Llama 3.3 · 70B' : model.id, runtime: 'lm-studio', offline: true })) }
              : { runtime: 'lm-studio', offline: true, models: [], error: 'LM Studio local server is unavailable.' }));
          } catch {
            res.statusCode = 503;
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify({ runtime: 'lm-studio', offline: true, models: [], error: 'Start the LM Studio local server to use offline AI.' }));
          }
        }
        if (req.method !== 'POST' || path !== '/chat') {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Unknown local AI endpoint.' }));
        }
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > LOCAL_AI_MAX_BODY) {
            res.statusCode = 413;
            return res.end(JSON.stringify({ error: 'Chat request is too large.' }));
          }
        }
        try {
          const payload = validateLocalChatPayload(JSON.parse(raw));
          const abort = new AbortController();
          req.on('aborted', () => abort.abort());
          res.on('close', () => { if (!res.writableEnded) abort.abort(); });
          const models = await (await fetch(`${LOCAL_AI_UPSTREAM}/api/v0/models`)).json();
          if (!(models.data || []).some((model) => model.id === payload.model && model.type === 'llm' && model.state === 'loaded')) throw new Error('Choose a loaded local model.');
          const wantsStream = /text\/event-stream/i.test(req.headers.accept || '');
          const upstream = await fetch(`${LOCAL_AI_UPSTREAM}/v1/chat/completions`, {
            method: 'POST',
            signal: abort.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...payload, max_tokens: LOCAL_AI_MAX_TOKENS, stream: wantsStream }),
          });
          if (!upstream.ok) throw new Error('LM Studio rejected the local request.');
          if (wantsStream && upstream.body) {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/event-stream');
            res.setHeader('cache-control', 'no-cache, no-transform');
            res.setHeader('connection', 'keep-alive');
            res.setHeader('x-accel-buffering', 'no');
            res.flushHeaders?.();
            for await (const chunk of upstream.body) res.write(chunk);
            return res.end();
          }
          const body = await upstream.json();
          const response = body.choices?.[0]?.message?.content;
          if (typeof response !== 'string') throw new Error('Local AI returned no response.');
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ runtime: 'lm-studio', model: payload.model, offline: true, response }));
        } catch (error) {
          if (error?.name === 'AbortError') return res.end();
          if (res.headersSent) return res.end();
          res.statusCode = error instanceof SyntaxError || /Choose|chat needs|Messages/.test(error.message) ? 400 : 503;
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ runtime: 'lm-studio', offline: true, error: error.message || 'Local AI is unavailable.' }));
        }
      });
    },
  };
}

export default defineConfig({
  // This copy shares node_modules with another app; keep optimized React local.
  cacheDir: '.vite-osat-field',
  resolve: { dedupe: ['react', 'react-dom'] },
  base: "./",
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@phosphor-icons/react"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [localAiApi(), react()],
});
