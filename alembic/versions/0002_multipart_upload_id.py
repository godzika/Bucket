"""add multipart_upload_id to stored_files

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stored_files",
        sa.Column("multipart_upload_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("stored_files", "multipart_upload_id")
