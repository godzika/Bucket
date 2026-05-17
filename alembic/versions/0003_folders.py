"""folders table and parent_folder_id on stored_files

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-17

"""
from __future__ import annotations

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROOT_NAME = "My files"


def upgrade() -> None:
    op.create_table(
        "folders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("name_lower", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_folders_owner_id", "folders", ["owner_id"])
    op.create_index("ix_folders_parent_id", "folders", ["parent_id"])
    op.create_index(
        "uq_folders_owner_root",
        "folders",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("is_root = true"),
    )
    op.create_index(
        "uq_folders_owner_parent_name",
        "folders",
        ["owner_id", "parent_id", "name_lower"],
        unique=True,
        postgresql_where=sa.text("is_root = false"),
    )

    op.add_column(
        "stored_files",
        sa.Column(
            "parent_folder_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_stored_files_parent_folder_id", "stored_files", ["parent_folder_id"])

    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    for (user_id,) in users:
        root_id = uuid.uuid4()
        conn.execute(
            sa.text(
                """
                INSERT INTO folders (id, owner_id, parent_id, name, name_lower, is_root)
                VALUES (:id, :owner_id, NULL, :name, '', true)
                """
            ),
            {"id": root_id, "owner_id": user_id, "name": ROOT_NAME},
        )
        folder_cache: dict[tuple[uuid.UUID, str], uuid.UUID] = {}

        def ensure_segments(parent_id: uuid.UUID, segments: list[str]) -> uuid.UUID:
            current = parent_id
            for segment in segments:
                key = (current, segment.casefold())
                if key in folder_cache:
                    current = folder_cache[key]
                    continue
                child_id = uuid.uuid4()
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO folders (id, owner_id, parent_id, name, name_lower, is_root)
                        VALUES (:id, :owner_id, :parent_id, :name, :name_lower, false)
                        """
                    ),
                    {
                        "id": child_id,
                        "owner_id": user_id,
                        "parent_id": current,
                        "name": segment,
                        "name_lower": segment.casefold(),
                    },
                )
                folder_cache[key] = child_id
                current = child_id
            return current

        files = conn.execute(
            sa.text(
                "SELECT id, original_filename FROM stored_files WHERE owner_id = :owner_id"
            ),
            {"owner_id": user_id},
        ).fetchall()
        for file_id, original_filename in files:
            path = original_filename.replace("\\", "/").lstrip("/")
            parts = [p for p in path.split("/") if p and p not in (".", "..")]
            if len(parts) <= 1:
                parent_id = root_id
                basename = parts[0] if parts else original_filename
            else:
                parent_id = ensure_segments(root_id, parts[:-1])
                basename = parts[-1]
            conn.execute(
                sa.text(
                    """
                    UPDATE stored_files
                    SET parent_folder_id = :parent_id, original_filename = :basename
                    WHERE id = :file_id
                    """
                ),
                {"parent_id": parent_id, "basename": basename, "file_id": file_id},
            )


def downgrade() -> None:
    op.drop_index("ix_stored_files_parent_folder_id", table_name="stored_files")
    op.drop_column("stored_files", "parent_folder_id")
    op.drop_index("uq_folders_owner_parent_name", table_name="folders")
    op.drop_index("uq_folders_owner_root", table_name="folders")
    op.drop_index("ix_folders_parent_id", table_name="folders")
    op.drop_index("ix_folders_owner_id", table_name="folders")
    op.drop_table("folders")
