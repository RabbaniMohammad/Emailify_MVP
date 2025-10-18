import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-page.component.html',
  styleUrls: ['./auth-page.component.scss']
})
export class AuthPageComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isLoading = false;
  errorMessage = '';

  ngOnInit(): void {
      // 🔓 TEMPORARY: Skip authentication
      this.router.navigate(['/']);
      return;
    // Listen for messages from OAuth popup
    window.addEventListener('message', this.handleAuthMessage.bind(this));

    // Check if already authenticated
    this.authService.isAuthenticated$.subscribe(isAuth => {
      if (isAuth) {
        const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';
        this.router.navigate([returnUrl]);
      }
    });

    // Check for error in URL
    const error = this.route.snapshot.queryParams['error'];
    if (error) {
      if (error === 'pending_approval') {
        this.router.navigate(['/auth/pending']);
      } else {
        this.errorMessage = this.getErrorMessage(error);
      }
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.handleAuthMessage.bind(this));
  }

    private handleAuthMessage(event: MessageEvent): void {
    console.log('📨 Received message:', event.data);
    console.log('Origin check:', event.origin, 'vs', window.location.origin);
    
    // Accept messages from backend (localhost:3000) or same origin (localhost:4200)
    const allowedOrigins = [
        window.location.origin,  // http://localhost:4200
        'http://localhost:3000'  // Backend
    ];
    
    if (!allowedOrigins.includes(event.origin)) {
        console.log('❌ Origin mismatch - message rejected');
        return;
    }

    const { type, user } = event.data;
    console.log('Message type:', type);

    if (type === 'AUTH_SUCCESS') {
        console.log('✅ AUTH_SUCCESS - redirecting to home');
        this.authService.handleAuthSuccess(user);
        window.location.href = '/';
    } else if (type === 'AUTH_PENDING') {
        console.log('⏳ AUTH_PENDING - navigating to pending page');
        this.router.navigate(['/auth/pending']);
    } else if (type === 'AUTH_DEACTIVATED') {
        console.log('🚫 AUTH_DEACTIVATED - showing error');
        this.errorMessage = 'Your account has been deactivated. Please contact your administrator.';
    }
    }

  onGoogleLogin(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.authService.loginWithGoogle();
    
    // Reset loading after popup opens
    setTimeout(() => {
      this.isLoading = false;
    }, 1000);
  }

  private getErrorMessage(error: string): string {
    const messages: Record<string, string> = {
      'google_auth_failed': 'Google authentication failed. Please try again.',
      'no_user': 'Unable to create user account. Please try again.',
      'callback_failed': 'Authentication callback failed. Please try again.',
      'pending_approval': 'Your account is pending admin approval.',
      'account_deactivated': 'Your account has been deactivated. Contact your administrator.',
      'authentication_failed': 'Authentication failed. Please try again.',
      'session_expired': 'Your session has expired. Please sign in again.', // ✅ NEW
      'access_denied': 'Access denied. Contact your administrator.', // ✅ NEW
    };
    return messages[error] || 'An error occurred during authentication. Please try again.';
  }
}