import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishCreateRulesCommandUseCase } from "../../../../src/application/use-cases/PublishCreateRulesCommandUseCase";
import { CommandPublisher, CreateRulesCommand } from "../../../../src/application/ports/CommandPublisher";
import { ValidationError, ServiceUnavailableError } from "../../../../src/application/errors/AppError";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createMockCommandPublisher(): CommandPublisher {
  return {
    publish: vi.fn(),
  };
}

describe("PublishCreateRulesCommandUseCase", () => {
  let commandPublisher: CommandPublisher;
  let useCase: PublishCreateRulesCommandUseCase;

  beforeEach(() => {
    commandPublisher = createMockCommandPublisher();
    useCase = new PublishCreateRulesCommandUseCase(commandPublisher);
  });

  describe("valid requests", () => {
    it("publishes a create_rules command with a generated operation_id", async () => {
      vi.mocked(commandPublisher.publish).mockResolvedValue(undefined);

      await useCase.execute(["1.1.1.1"], "blacklist");

      expect(commandPublisher.publish).toHaveBeenCalledTimes(1);
      const published = vi.mocked(commandPublisher.publish).mock.calls[0][0] as CreateRulesCommand;
      expect(published.command_type).toBe("create_rules");
      expect(published.payload).toEqual({ type: "ip", mode: "blacklist", values: ["1.1.1.1"] });
      expect(published.operation_id).toMatch(UUID_REGEX);
    });

    it("passes every value through in the published payload", async () => {
      vi.mocked(commandPublisher.publish).mockResolvedValue(undefined);

      await useCase.execute(["10.0.0.1", "10.0.0.2"], "whitelist");

      const published = vi.mocked(commandPublisher.publish).mock.calls[0][0] as CreateRulesCommand;
      expect(published.payload.values).toEqual(["10.0.0.1", "10.0.0.2"]);
      expect(published.payload.mode).toBe("whitelist");
    });

    it("returns the same operation_id that was published", async () => {
      vi.mocked(commandPublisher.publish).mockResolvedValue(undefined);

      const result = await useCase.execute(["1.1.1.1"], "blacklist");

      const published = vi.mocked(commandPublisher.publish).mock.calls[0][0] as CreateRulesCommand;
      expect(result).toEqual({ operation_id: published.operation_id });
    });

    it("generates a different operation_id on each call", async () => {
      vi.mocked(commandPublisher.publish).mockResolvedValue(undefined);

      const first = await useCase.execute(["1.1.1.1"], "blacklist");
      const second = await useCase.execute(["1.1.1.1"], "blacklist");

      expect(first.operation_id).not.toBe(second.operation_id);
    });
  });

  describe("validation happens before publishing", () => {
    it("throws ValidationError for an invalid mode and does not call publish", async () => {
      await expect(useCase.execute(["1.1.1.1"], "allow")).rejects.toThrow(ValidationError);
      expect(commandPublisher.publish).not.toHaveBeenCalled();
    });

    it("throws ValidationError for an empty values array and does not call publish", async () => {
      await expect(useCase.execute([], "blacklist")).rejects.toThrow(ValidationError);
      expect(commandPublisher.publish).not.toHaveBeenCalled();
    });

    it("throws ValidationError for a non-array values and does not call publish", async () => {
      await expect(useCase.execute(undefined, "blacklist")).rejects.toThrow(ValidationError);
      expect(commandPublisher.publish).not.toHaveBeenCalled();
    });

    it("throws ValidationError for an invalid IPv4 value and does not call publish", async () => {
      await expect(useCase.execute(["not-an-ip"], "blacklist")).rejects.toThrow(ValidationError);
      expect(commandPublisher.publish).not.toHaveBeenCalled();
    });

    it("throws ValidationError for a value that is a valid domain but not a valid IPv4", async () => {
      await expect(useCase.execute(["example.com"], "blacklist")).rejects.toThrow(ValidationError);
      expect(commandPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe("publisher failure", () => {
    it("propagates ServiceUnavailableError thrown by commandPublisher.publish", async () => {
      vi.mocked(commandPublisher.publish).mockRejectedValue(
        new ServiceUnavailableError("RABBITMQ_PUBLISH_FAILED", "Failed to publish command to RabbitMQ."),
      );

      await expect(useCase.execute(["1.1.1.1"], "blacklist")).rejects.toThrow(ServiceUnavailableError);
    });
  });
});
