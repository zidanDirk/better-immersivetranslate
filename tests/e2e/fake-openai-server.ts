import { createServer, type IncomingHttpHeaders } from "node:http";

export interface ReceivedOpenAiRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export async function startFakeOpenAiServer(options?: {
  cors?: boolean;
  disconnectPost?: boolean;
  pageHtml?: string;
  responseDelayMs?: number;
  responseBody?: unknown;
  statusCode?: number;
}): Promise<{
  endpoint: string;
  pageUrl: string;
  receivedRequest: Promise<ReceivedOpenAiRequest>;
  receivedRequests: ReceivedOpenAiRequest[];
  close: () => Promise<void>;
}> {
  const receivedRequests: ReceivedOpenAiRequest[] = [];
  let resolveRequest: (request: ReceivedOpenAiRequest) => void = () => {};
  const receivedRequest = new Promise<ReceivedOpenAiRequest>((resolve) => {
    resolveRequest = resolve;
  });

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/test-page") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(options?.pageHtml ?? "<p>Test page</p>");
      return;
    }

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
      const receivedRequest = {
        path: request.url ?? "",
        headers: request.headers,
        body: JSON.parse(bodyText) as unknown,
      };
      receivedRequests.push(receivedRequest);
      resolveRequest(receivedRequest);
      setTimeout(() => {
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
      }, options?.responseDelayMs ?? 0);
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
    pageUrl: `http://127.0.0.1:${address.port}/test-page`,
    receivedRequest,
    receivedRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
