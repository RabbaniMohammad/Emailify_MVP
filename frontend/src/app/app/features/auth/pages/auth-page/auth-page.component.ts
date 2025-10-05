import { Component, OnInit, inject } from '@angular/core';
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
export class AuthPageComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isLoading = false;
  errorMessage = '';

    ngOnInit(): void {
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
        // Redirect to beautiful pending page
        this.router.navigate(['/auth/pending']);
        } else {
        this.errorMessage = this.getErrorMessage(error);
        }
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
        'pending_approval': 'Your account is pending admin approval. Please wait for an administrator to review your request.',
        'account_deactivated': 'Your account has been deactivated. Please contact an administrator.',
        'authentication_failed': 'Authentication failed. Please try again.',
    };
    return messages[error] || 'An error occurred during authentication. Please try again.';
    }
}