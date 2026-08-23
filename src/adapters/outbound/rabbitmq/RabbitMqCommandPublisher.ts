import { connect, ChannelModel, ConfirmChannel } from "amqplib";
import { CommandPublisher, CreateRulesCommand } from "../../../application/ports/CommandPublisher";
import { ServiceUnavailableError } from "../../../application/errors/AppError";

export interface RabbitMqPublisherConfig {
  url: string;
  exchange: string;
  routingPrefix: string;
}

export class RabbitMqCommandPublisher implements CommandPublisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  // Holds the in-flight connect sequence so concurrent connect() calls share
  // it instead of opening parallel connections — mirrors PostgresConnection's
  // connectingPromise pattern.
  private connectingPromise: Promise<void> | null = null;

  constructor(private readonly config: RabbitMqPublisherConfig) {}

  async connect(): Promise<void> {
    if (this.channel) {
      return;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = this.doConnect();

    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    const connection = await connect(this.config.url);
    const channel = await connection.createConfirmChannel();
    this.connection = connection;
    this.channel = channel;
  }

  async publish(command: CreateRulesCommand): Promise<void> {
    if (!this.channel) {
      throw new ServiceUnavailableError(
        "RABBITMQ_UNAVAILABLE",
        "RabbitMQ channel is not connected.",
      );
    }

    const channel = this.channel;
    const routingKey = `${this.config.routingPrefix}.rule.create`;
    const content = Buffer.from(JSON.stringify(command));

    try {
      await new Promise<void>((resolve, reject) => {
        channel.publish(
          this.config.exchange,
          routingKey,
          content,
          { contentType: "application/json", persistent: true },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch {
      throw new ServiceUnavailableError(
        "RABBITMQ_PUBLISH_FAILED",
        "Failed to publish command to RabbitMQ.",
      );
    }
  }

  async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close().catch(() => undefined);
    }
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
    }
    this.channel = null;
    this.connection = null;
    this.connectingPromise = null;
  }
}
