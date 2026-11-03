import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

logger = logging.getLogger(__name__)


def board_group(board_id):
    return f'board.{board_id}'


def publish_board(board_id):
    """Only announce committed data. Heartbeat sync also repairs missed events."""
    def publish():
        try:
            async_to_sync(get_channel_layer().group_send)(board_group(board_id), {'type': 'board.changed'})
        except Exception:
            logger.exception('Board notification failed for %s', board_id)
    transaction.on_commit(publish)
