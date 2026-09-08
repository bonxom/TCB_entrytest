import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createStubProvider } from '../../src/ai/stub-provider.js';
import { ProviderFailure } from '../../src/ai/provider.js';

// Fixed randomness: 2s latency, no synthetic 500, Retry-After of 2s.
// Concurrency enforcement still comes from the real stub implementation.
const provider = createStubProvider({ seed: 42, random: () => 0.5 });
const startedAt = performance.now();

function log(message: string): void {
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
  console.log(`[${elapsed}s] ${message}`);
}

async function callProvider(callId: number) {
  log(`Call ${callId} → gọi provider`);
  try {
    const result = await provider.summarize(
      `Nội dung cần tóm tắt của call ${callId}.`,
    );
    log(`Call ${callId} → thành công | summary: ${result.summary}`);
    return result;
  } catch (error) {
    if (error instanceof ProviderFailure && error.retryAfterMs !== undefined) {
      log(
        `Call ${callId} → vượt giới hạn (tương đương 429) | Retry-After: ${error.retryAfterMs / 1000}s | code: ${error.code}`,
      );
    } else {
      log(`Call ${callId} → lỗi ngoài dự kiến`);
    }
    throw error;
  }
}

console.log(
  'Gọi trực tiếp cùng một stub instance; không gửi HTTP và không gọi AI thật.',
);
const results = await Promise.allSettled([
  callProvider(1),
  callProvider(2),
  callProvider(3),
]);

assert.equal(results[0]?.status, 'fulfilled', 'Call 1 phải thành công');
assert.equal(results[1]?.status, 'fulfilled', 'Call 2 phải thành công');
const third = results[2];
assert.equal(third?.status, 'rejected', 'Call 3 phải bị từ chối');
if (third?.status === 'rejected') {
  assert(third.reason instanceof ProviderFailure);
  assert.equal(third.reason.kind, 'transient');
  assert.equal(third.reason.retryAfterMs, 2000);
}
console.log(
  '\nPASS: 2 calls thành công, call thứ 3 bị từ chối. Script không tự retry.',
);
