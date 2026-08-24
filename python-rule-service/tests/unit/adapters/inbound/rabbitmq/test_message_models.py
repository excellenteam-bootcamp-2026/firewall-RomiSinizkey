import pytest
from pydantic import ValidationError

from src.adapters.inbound.rabbitmq.message_models import CreateRulesCommand

VALID_RAW = {
    "operation_id": "11111111-1111-1111-1111-111111111111",
    "command_type": "create_rules",
    "payload": {
        "type": "ip",
        "mode": "blacklist",
        "values": ["1.2.3.4"],
    },
}


class TestValidCommand:
    def test_parses_a_valid_command(self) -> None:
        command = CreateRulesCommand.model_validate(VALID_RAW)

        assert command.operation_id == VALID_RAW["operation_id"]
        assert command.command_type == "create_rules"
        assert command.payload.type == "ip"
        assert command.payload.mode == "blacklist"
        assert command.payload.values == ["1.2.3.4"]

    def test_parses_multiple_values(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "values": ["1.1.1.1", "8.8.8.8"]}}

        command = CreateRulesCommand.model_validate(raw)

        assert command.payload.values == ["1.1.1.1", "8.8.8.8"]

    def test_accepts_whitelist_mode(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "mode": "whitelist"}}

        command = CreateRulesCommand.model_validate(raw)

        assert command.payload.mode == "whitelist"

    def test_model_is_frozen(self) -> None:
        command = CreateRulesCommand.model_validate(VALID_RAW)

        with pytest.raises(ValidationError):
            command.operation_id = "22222222-2222-2222-2222-222222222222"


class TestInvalidOperationId:
    def test_rejects_a_non_uuid_operation_id(self) -> None:
        raw = {**VALID_RAW, "operation_id": "not-a-uuid"}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)

    def test_rejects_a_missing_operation_id(self) -> None:
        raw = {k: v for k, v in VALID_RAW.items() if k != "operation_id"}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)


class TestInvalidCommandType:
    def test_rejects_an_unknown_command_type(self) -> None:
        raw = {**VALID_RAW, "command_type": "delete_rules"}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)

    def test_rejects_a_missing_command_type(self) -> None:
        raw = {k: v for k, v in VALID_RAW.items() if k != "command_type"}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)


class TestInvalidPayloadType:
    def test_rejects_a_non_ip_payload_type(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "type": "domain"}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)


class TestInvalidMode:
    def test_rejects_an_unsupported_mode(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "mode": "allow"}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)


class TestInvalidValues:
    def test_rejects_an_empty_values_list(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "values": []}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)

    def test_rejects_a_non_list_values(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "values": "1.2.3.4"}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)

    def test_rejects_an_invalid_ipv4_value(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "values": ["999.999.999.999"]}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)

    def test_rejects_when_only_one_of_several_values_is_invalid(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "values": ["1.2.3.4", "not-an-ip"]}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)

    def test_rejects_a_domain_value_it_is_not_an_ipv4_address(self) -> None:
        raw = {**VALID_RAW, "payload": {**VALID_RAW["payload"], "values": ["example.com"]}}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)


class TestMissingPayload:
    def test_rejects_a_missing_payload(self) -> None:
        raw = {k: v for k, v in VALID_RAW.items() if k != "payload"}

        with pytest.raises(ValidationError):
            CreateRulesCommand.model_validate(raw)
