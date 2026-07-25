import { createServer, type IncomingHttpHeaders } from "node:http";

export interface ReceivedOpenAiRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export async function startFakeOpenAiServer(options?: {
  cors?: boolean;
  disconnectPost?: boolean;
  responseBody?: unknown;
  statusCode?: number;
}): Promise<{
  endpoint: string;
  receivedRequest: Promise<ReceivedOpenAiRequest>;
  close: () => Promise<void>;
}> {
  let resolveRequest: (request: ReceivedOpenAiRequest) => void = () => {};
  const receivedRequest = new Promise<ReceivedOpenAiRequest>((resolve) => {
    resolveRequest = resolve;
  });

  const server = createServer((request, response) => {
    if (options?.cors !== false) {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Test",
      );
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }

    if (options?.disconnectPost) {
      request.socket.destroy();
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      resolveRequest({
        path: request.url ?? "",
        headers: request.headers,
        body: JSON.parse(bodyText) as unknown,
      });
      response.writeHead(options?.statusCode ?? 200, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify(
          options && "responseBody" in options
            ? options.responseBody
            : { choices: [{ message: { content: "OK" } }] },
        ),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake OpenAI-compatible server 未能监听 TCP 端口");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    receivedRequest,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
