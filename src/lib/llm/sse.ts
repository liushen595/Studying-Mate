export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser for fetch Response.body.
 */
export async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: SSEEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const flushBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      onEvent({
        event: eventName,
        data: dataLines.join('\n'),
      });
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex = buffer.search(/\r?\n\r?\n/);
      while (sepIndex !== -1) {
        const block = buffer.slice(0, sepIndex);
        const match = buffer.slice(sepIndex).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(sepIndex + (match ? match[0].length : 2));
        if (block.trim()) flushBlock(block);
        sepIndex = buffer.search(/\r?\n\r?\n/);
      }
    }

    const tail = buffer + decoder.decode();
    if (tail.trim()) {
      flushBlock(tail);
    }
  } finally {
    reader.releaseLock();
  }
}
