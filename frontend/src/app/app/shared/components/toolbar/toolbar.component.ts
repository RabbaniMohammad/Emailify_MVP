import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';  
import { RouterModule } from '@angular/router';
import { TemplatesService } from '../../../core/services/templates.service';
import { AuthService } from '../../../../app/core/services/auth.service';
import { AdminService } from '../../../core/services/admin.service';
import { map, shareReplay } from 'rxjs/operators';
import { Router } from '@angular/router';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatButtonModule, RouterModule, MatIconModule],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.scss'],
})
export class ToolbarComponent implements OnInit {
  private svc = inject(TemplatesService);
  private authService = inject(AuthService);
  private adminService = inject(AdminService);

  private router = inject(Router);

  pendingCount$ = this.adminService.getPendingUsers().pipe(
    map(response => response.users.length),
    shareReplay(1)
  );

  ngOnInit(): void {
    // Refresh pending count every minute
    setInterval(() => {
      this.pendingCount$ = this.adminService.getPendingUsers().pipe(
        map(response => response.users.length),
        shareReplay(1)
      );
    }, 60000);
  }

  isAdmin(): boolean {
    const user = this.authService.currentUserValue;
    return user?.role === 'admin' || user?.role === 'super_admin';
  }

  navigateToAdmin(): void {
    // Force reload by navigating away and back
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
      this.router.navigate(['/admin']);
    });
  }

  refresh(): void {
    this.svc.refresh();
  }
}