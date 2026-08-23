import { describe, it, expect, beforeEach, vi } from "vitest";
import { RabbitMqCommandPublisher } from "../../../../../src/adapters/outbound/rabbitmq/RabbitMqCommandPublisher";
import { CreateRulesCommand } from "../../../../../src/application/ports/CommandPublisher";
import { ServiceUnavailableError } from "../../../../../src/application/errors/AppError";

// Structurally typed instead of the global `Buffer` (which amqplib's own
// types use) — tests/ isn't covered by tsconfig.json's `include: ["src"]`,
// so an editor checking this file in isolation may not have Node's ambient
// types loaded even though npm run lint/test are unaffected either way. The
// real adapter still passes a real Buffer at runtime; only this mock's type
// annotation avoids the name.
interface BinaryMessageContent {
  toString(encoding: string): string;
}

// Fakes for "amqplib", defined via vi.hoisted() so they're available inside
// the hoisted vi.mock() factory below — same pattern as connection.test.ts's
// "pg" mock.
const amqpMock = vi.hoisted(() => {
  const state: {
    connectUrls: string[];
    connectShouldFail: boolean;
    createConfirmChannelCalls: number;
    publishCalls: Array<{ exchange: string; routingKey: string; content: string; options: unknown }>;
    publishConfirmImpl: (callback: (err: unknown, ok: unknown) => void) => void;
  } = {
    connectUrls: [],
    connectShouldFail: false,
    createConfirmChannelCalls: 0,
    publishCalls: [],
    publishConfirmImpl: (callback) => callback(null, {}),
  };

  const fakeConfirmChannel = {
    publish: vi.fn(
      (
        exchange: string,
        routingKey: string,
        content: BinaryMessageContent,
        options: unknown,
        callback: (err: unknown, ok: unknown) => void,
      ) => {
        state.publishCalls.push({ exchange, routingKey, content: content.toString("utf8"), options });
        state.publishConfirmImpl(callback);
        return true;
      },
    ),
    close: vi.fn(async () => undefined),
  };

  const fakeChannelModel = {
    createConfirmChannel: vi.fn(async () => {
      state.createConfirmChannelCalls += 1;
      return fakeConfirmChannel;
    }),
    close: vi.fn(async () => undefined),
  };

  const connect = vi.fn(async (url: string) => {
    state.connectUrls.push(url);
    if (state.connectShouldFail) {
      throw new Error("connection refused");
    }
    return fakeChannelModel;
  });

  return { state, connect, fakeConfirmChannel, fakeChannelModel };
});

vi.mock("amqplib", () => ({ connect: amqpMock.connect }));

const validConfig = {
  url: "amqps://user:pass@host/vhost",
  exchange: "firewall.commands",
  routingPrefix: "romi",
};

const sampleCommand: CreateRulesCommand = {
  operation_id: "11111111-1111-1111-1111-111111111111",
  command_type: "create_rules",
  payload: {
    type: "ip",
    mode: "blacklist",
    values: ["1.1.1.1"],
  },
};

describe("RabbitMqCommandPublisher", () => {
  beforeEach(() => {
    amqpMock.state.connectUrls = [];
    amqpMock.state.connectShouldFail = false;
    amqpMock.state.createConfirmChannelCalls = 0;
    amqpMock.state.publishCalls = [];
    amqpMock.state.publishConfirmImpl = (callback) => callback(null, {});
    amqpMock.connect.mockClear();
    amqpMock.fakeChannelModel.createConfirmChannel.mockClear();
    amqpMock.fakeChannelModel.close.mockClear();
    amqpMock.fakeConfirmChannel.publish.mockClear();
    amqpMock.fakeConfirmChannel.close.mockClear();
  });

  it("connect() opens exactly one connection using the configured URL and one confirm channel", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);

    await publisher.connect();

    expect(amqpMock.state.connectUrls).toEqual([validConfig.url]);
    expect(amqpMock.state.createConfirmChannelCalls).toBe(1);
  });

  it("calling connect() again reuses the existing channel instead of reconnecting", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);

    await publisher.connect();
    await publisher.connect();

    expect(amqpMock.state.connectUrls).toHaveLength(1);
    expect(amqpMock.state.createConfirmChannelCalls).toBe(1);
  });

  it("concurrent connect() calls share the same in-flight attempt, not separate connections", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);

    await Promise.all([publisher.connect(), publisher.connect()]);

    expect(amqpMock.state.connectUrls).toHaveLength(1);
  });

  it("publish() reuses the connected channel rather than opening a new connection per call", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();

    await publisher.publish(sampleCommand);
    await publisher.publish(sampleCommand);

    expect(amqpMock.state.connectUrls).toHaveLength(1);
    expect(amqpMock.state.createConfirmChannelCalls).toBe(1);
    expect(amqpMock.fakeConfirmChannel.publish).toHaveBeenCalledTimes(2);
  });

  it("publishes to the configured exchange using a routing key built from the routing prefix", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();

    await publisher.publish(sampleCommand);

    expect(amqpMock.state.publishCalls[0].exchange).toBe("firewall.commands");
    expect(amqpMock.state.publishCalls[0].routingKey).toBe("romi.rule.create");
  });

  it("serializes the exact command as the JSON message body", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();

    await publisher.publish(sampleCommand);

    expect(JSON.parse(amqpMock.state.publishCalls[0].content)).toEqual(sampleCommand);
  });

  it("awaits the broker's confirmation callback before resolving", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();

    let confirmedBeforeResolve = false;
    amqpMock.state.publishConfirmImpl = (callback) => {
      setTimeout(() => {
        confirmedBeforeResolve = true;
        callback(null, {});
      }, 0);
    };

    await publisher.publish(sampleCommand);

    expect(confirmedBeforeResolve).toBe(true);
  });

  it("publish() throws a 503 ServiceUnavailableError when the broker errors the confirmation", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();
    amqpMock.state.publishConfirmImpl = (callback) => callback(new Error("channel closed"), undefined);

    await expect(publisher.publish(sampleCommand)).rejects.toThrow(ServiceUnavailableError);
    await expect(publisher.publish(sampleCommand)).rejects.toMatchObject({
      statusCode: 503,
      code: "RABBITMQ_PUBLISH_FAILED",
    });
  });

  it("publish() throws a 503 ServiceUnavailableError when called before connect()", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);

    await expect(publisher.publish(sampleCommand)).rejects.toMatchObject({
      statusCode: 503,
      code: "RABBITMQ_UNAVAILABLE",
    });
  });

  it("close() closes both the confirm channel and the connection", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();

    await publisher.close();

    expect(amqpMock.fakeConfirmChannel.close).toHaveBeenCalledTimes(1);
    expect(amqpMock.fakeChannelModel.close).toHaveBeenCalledTimes(1);
  });

  it("close() is safe to call when never connected", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);

    await expect(publisher.close()).resolves.not.toThrow();
    expect(amqpMock.fakeConfirmChannel.close).not.toHaveBeenCalled();
  });

  it("calling close() twice does not double-close", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();

    await publisher.close();
    await publisher.close();

    expect(amqpMock.fakeConfirmChannel.close).toHaveBeenCalledTimes(1);
    expect(amqpMock.fakeChannelModel.close).toHaveBeenCalledTimes(1);
  });

  it("after close(), publish() throws 503 rather than using a stale channel", async () => {
    const publisher = new RabbitMqCommandPublisher(validConfig);
    await publisher.connect();
    await publisher.close();

    await expect(publisher.publish(sampleCommand)).rejects.toMatchObject({ statusCode: 503 });
  });

  it("propagates a raw connection error from connect() (startup should fail, not be swallowed)", async () => {
    amqpMock.state.connectShouldFail = true;
    const publisher = new RabbitMqCommandPublisher(validConfig);

    await expect(publisher.connect()).rejects.toThrow("connection refused");
  });
});
