import pytest

from src.application.errors import ApplicationError


class TestConstruction:
    def test_stores_code_and_message(self) -> None:
        err = ApplicationError(code="INVALID_IP", message="not a valid IPv4 address")

        assert err.code == "INVALID_IP"
        assert err.message == "not a valid IPv4 address"

    def test_is_a_real_exception_and_can_be_raised(self) -> None:
        with pytest.raises(ApplicationError) as excinfo:
            raise ApplicationError(code="INVALID_IP", message="not a valid IPv4 address")

        assert excinfo.value.code == "INVALID_IP"
        assert excinfo.value.message == "not a valid IPv4 address"


class TestStableFields:
    def test_code_and_message_are_stable_across_repeated_access(self) -> None:
        err = ApplicationError(code="INVALID_MODE", message="mode must be blacklist or whitelist")

        assert err.code == "INVALID_MODE"
        assert err.code == "INVALID_MODE"
        assert err.message == "mode must be blacklist or whitelist"

    def test_different_instances_do_not_share_state(self) -> None:
        first = ApplicationError(code="INVALID_IP", message="first")
        second = ApplicationError(code="INVALID_MODE", message="second")

        assert first.code != second.code
        assert first.message != second.message


class TestRepresentation:
    def test_str_contains_only_code_and_message(self) -> None:
        err = ApplicationError(code="INVALID_IP", message="not a valid IPv4 address")

        assert str(err) == "[INVALID_IP] not a valid IPv4 address"

    def test_repr_contains_only_code_and_message(self) -> None:
        err = ApplicationError(code="INVALID_IP", message="not a valid IPv4 address")

        assert repr(err) == "ApplicationError(code='INVALID_IP', message='not a valid IPv4 address')"

    def test_to_dict_contains_only_code_and_message(self) -> None:
        err = ApplicationError(code="INVALID_IP", message="not a valid IPv4 address")

        assert err.to_dict() == {"code": "INVALID_IP", "message": "not a valid IPv4 address"}

    def test_instance_carries_no_field_beyond_code_and_message(self) -> None:
        err = ApplicationError(code="INVALID_IP", message="not a valid IPv4 address")

        assert set(vars(err).keys()) == {"code", "message"}
