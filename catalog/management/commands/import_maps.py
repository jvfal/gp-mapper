import json
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from catalog.models import MapChest, MapDungeon, MapResource, RoadMap


FEATURES = [
    ('resources', MapResource, 'resource_type'),
    ('chests', MapChest, 'chest_type'),
    ('dungeons', MapDungeon, 'dungeon_type'),
]


def validate_catalog(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('maps'), list):
        raise CommandError('O JSON deve conter uma lista em "maps".')
    seen_ids, seen_names = set(), set()
    for row in payload['maps']:
        if not isinstance(row, dict):
            raise CommandError('Cada mapa deve ser um objeto.')
        for field in ('id', 'name', 'tier', 'image', 'resources', 'chests', 'dungeons'):
            if field not in row:
                raise CommandError(f'Campo ausente: {field}.')
        if type(row['id']) is not int or type(row['tier']) is not int:
            raise CommandError('ID e tier devem ser inteiros.')
        if not isinstance(row['name'], str) or not isinstance(row['image'], str):
            raise CommandError('Nome e imagem devem ser strings.')
        if row['id'] in seen_ids or row['name'] in seen_names:
            raise CommandError(f'Mapa duplicado: {row["name"]}.')
        seen_ids.add(row['id'])
        seen_names.add(row['name'])
        roadmap = RoadMap(**{field: row[field] for field in ('id', 'name', 'tier', 'image')})
        try:
            roadmap.full_clean(validate_unique=False, validate_constraints=False)
            for collection, model, type_field in FEATURES:
                if not isinstance(row[collection], list):
                    raise CommandError(f'{row["name"]}: {collection} deve ser uma lista.')
                seen_features = set()
                for feature in row[collection]:
                    if not isinstance(feature, dict) or not {'type', 'size', 'count'} <= feature.keys():
                        raise CommandError(f'{row["name"]}: item invalido em {collection}.')
                    if not isinstance(feature['type'], str) or not isinstance(feature['size'], str):
                        raise CommandError(f'{row["name"]}: tipo e tamanho devem ser strings.')
                    if type(feature['count']) is not int:
                        raise CommandError(f'{row["name"]}: quantidade deve ser um inteiro.')
                    key = (feature['type'], feature['size'])
                    if key in seen_features:
                        raise CommandError(f'{row["name"]}: item duplicado em {collection}: {key}.')
                    seen_features.add(key)
                    instance = model(
                        road_map_id=row['id'], **{type_field: feature['type']},
                        size=feature['size'], count=feature['count'],
                    )
                    instance.full_clean(
                        exclude=['road_map'], validate_unique=False, validate_constraints=False,
                    )
        except ValidationError as exc:
            raise CommandError(f'{row["name"]}: {exc}') from exc
    return payload['maps']


class Command(BaseCommand):
    help = 'Importa/atualiza o catalogo normalizado sem duplicar mapas ou apagar mapas ausentes.'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', type=Path, default=settings.BASE_DIR / 'maps.json')
        parser.add_argument('--dry-run', action='store_true', help='Valida sem modificar o banco.')

    def handle(self, *args, **options):
        try:
            payload = json.loads(options['path'].read_text(encoding='utf-8-sig'))
        except (OSError, ValueError) as exc:
            raise CommandError(f'Nao foi possivel ler o catalogo: {exc}') from exc
        rows = validate_catalog(payload)
        if options['dry_run']:
            self.stdout.write(self.style.SUCCESS(f'Catalogo valido: {len(rows)} mapas. Nenhuma alteracao.'))
            return

        created = 0
        try:
            with transaction.atomic():
                for row in rows:
                    roadmap, is_new = RoadMap.objects.update_or_create(
                        pk=row['id'], defaults={field: row[field] for field in ('name', 'tier', 'image')},
                    )
                    created += is_new
                    for collection, model, type_field in FEATURES:
                        retained = []
                        for feature in row[collection]:
                            instance, _ = model.objects.update_or_create(
                                road_map=roadmap, **{type_field: feature['type']},
                                size=feature['size'], defaults={'count': feature['count']},
                            )
                            retained.append(instance.pk)
                        # The file is authoritative for features of imported maps only.
                        model.objects.filter(road_map=roadmap).exclude(pk__in=retained).delete()
        except IntegrityError as exc:
            raise CommandError('Conflito com dados existentes. A importacao foi revertida.') from exc
        self.stdout.write(self.style.SUCCESS(
            f'{len(rows)} mapas importados: {created} criados, {len(rows) - created} atualizados.',
        ))
