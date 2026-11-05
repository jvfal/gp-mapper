"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path

from catalog.views import map_catalog
from mapper.views import index
from mapper.boards import boards, board_detail, board_access
from mapper.authentication import discord_start, discord_callback, sign_out, current_session
from mapper.configuration import configuration, configure_mapper, prepare_discord_channel
from mapper.branding import configure_branding, guild_icon
from mapper.members import members, roles, member_roles, member_approval

urlpatterns = [
    path('api/settings/branding/', configure_branding, name='configure-branding'),
    path('assets/guild-icon/<str:digest>.png', guild_icon, name='guild-icon'),
    path('api/session/', current_session, name='current-session'),
    path('api/settings/', configuration, name='guild-settings'),
    path('api/settings/modules/mapper/', configure_mapper, name='configure-mapper'),
    path('api/settings/modules/mapper/discord-channel/', prepare_discord_channel, name='prepare-discord-channel'),
    path('api/members/', members, name='guild-members'),
    path('api/members/<int:user_id>/roles/', member_roles, name='member-roles'),
    path('api/members/<int:user_id>/approval/', member_approval, name='member-approval'),
    path('api/roles/', roles, name='guild-roles'),
    path('api/roles/<int:role_id>/', roles, name='guild-role-detail'),
    path('', index, name='mapper'),
    path('auth/discord/login/', discord_start, name='discord-login'),
    path('auth/discord/callback/', discord_callback, name='discord-callback'),
    path('auth/logout/', sign_out, name='mapper-logout'),
    path('api/catalog/maps/', map_catalog, name='map-catalog'),
    path('api/boards/', boards, name='board-list'),
    path('api/boards/<uuid:board_id>/', board_detail, name='board-detail'),
    path('api/boards/<uuid:board_id>/access/', board_access, name='board-access'),
    path('admin/', admin.site.urls),
]
