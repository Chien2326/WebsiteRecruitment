"""job views per day (admin analytics)

Revision ID: b7c1d2e3f4a5
Revises: 88090beecae4
Create Date: 2026-11-13 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c1d2e3f4a5'
down_revision: Union[str, Sequence[str], None] = '88090beecae4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_views_daily',
        sa.Column('job_id', sa.UUID(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('views', sa.Integer(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], name=op.f('job_views_daily_job_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('job_id', 'day', name=op.f('job_views_daily_pkey')),
    )
    op.create_index('ix_job_views_daily_day', 'job_views_daily', ['day'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_job_views_daily_day', table_name='job_views_daily')
    op.drop_table('job_views_daily')
