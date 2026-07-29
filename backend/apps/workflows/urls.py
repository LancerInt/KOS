from django.urls import path

from .views import ProjectWorkflowView

urlpatterns = [
    path("projects/<int:project_id>/workflow/", ProjectWorkflowView.as_view(), name="project-workflow"),
]
