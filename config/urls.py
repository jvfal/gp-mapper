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
from mapper.authentication import discord_start, discord_callback, sign_out

urlpatterns = [
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
