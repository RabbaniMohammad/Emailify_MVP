import { Component, OnInit, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #E5893F 0%, #E5893F 100%);">
      <div style="text-align: center; color: white;">
        <div style="width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem;"></div>
        <p style="font-size: 1.125rem; font-weight: 600;">Completing sign in...</p>
      </div>
    </div>
  `,
  styles: [`
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `]
})
export class AuthCallbackComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const success = this.route.snapshot.queryParams['success'];
    
    if (success === 'true') {
      this.authService.handleAuthCallback();
      
      // Close popup if this is a popup window
      if (window.opener) {
        window.close();
      } else {
        // Navigate to home if opened in main window - replaceUrl to avoid back button going to callback
        const returnUrl = sessionStorage.getItem('auth_return_url') || '/';
        sessionStorage.removeItem('auth_return_url');
        this.router.navigate([returnUrl], { replaceUrl: true });
      }
    } else {
      this.router.navigate(['/auth'], { queryParams: { error: 'callback_failed' } });
    }
  }
}