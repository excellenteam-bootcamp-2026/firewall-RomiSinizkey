import pytest

from src.domain.errors import InvalidIpError


class TestInvalidIpError:
    def test_stores_the_message(self) -> None:
        err = InvalidIpError('"999.1.1.1" is not a valid IPv4 address.')

        assert err.message == '"999.1.1.1" is not a valid IPv4 address.'

    def test_is_a_real_exception_and_can_be_raised(self) -> None:
        with pytest.raises(InvalidIpError) as excinfo:
            raise InvalidIpError("not a valid IPv4 address")

        assert excinfo.value.message == "not a valid IPv4 address"

    def test_is_not_an_application_error(self) -> None:
        from src.application.errors import ApplicationError

        assert not issubclass(InvalidIpError, ApplicationError)
