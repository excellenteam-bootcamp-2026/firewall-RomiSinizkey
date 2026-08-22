from sqlalchemy import Boolean, Column, Integer, MetaData, Table, Text

metadata = MetaData()

firewall_rules = Table(
    "firewall_rules",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("type", Text, nullable=False),
    Column("mode", Text, nullable=False),
    Column("value", Text, nullable=False),
    Column("active", Boolean, nullable=False),
)
