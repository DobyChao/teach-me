import { request } from 'node:http';

// Long polls may intentionally receive no headers for eight minutes. Use one
// explicit deadline instead of fetch's independent response-header timeout.
export function postJson(port, route, headers, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = request({
      hostname: '127.0.0.1',
      port,
      path: `/${route}`,
      method: 'POST',
      agent: false,
      headers: {
        ...headers,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    });
    const deadline = setTimeout(() => req.destroy(new Error(`应用请求超时：${route}`)), timeoutMs);
    req.on('error', reject);
    req.on('close', () => clearTimeout(deadline));
    req.on('response', (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 16 * 1024 * 1024) req.destroy(new Error('应用响应过大'));
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const result = JSON.parse(raw);
          if (res.statusCode < 200 || res.statusCode >= 300)
            throw new Error(result.error || `HTTP ${res.statusCode}`);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.end(payload);
  });
}
