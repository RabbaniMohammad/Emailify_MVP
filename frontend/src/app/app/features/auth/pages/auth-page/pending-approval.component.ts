import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-pending-approval',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pending-container">
      <div class="pending-card">
        <div class="icon-container">
          <div class="icon-backdrop"></div>
          <svg class="pending-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>

        <h1>Pending Approval</h1>
        <p class="message">Your account has been created and is awaiting administrator approval.</p>

        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>You'll receive access once an administrator reviews your request. This typically takes 1-2 business days.</p>
        </div>

        <button class="back-btn" (click)="closeWindow()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
          </svg>
          <span>Back to Sign In</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .pending-container {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 2rem;
    }

    .pending-card {
      max-width: 500px;
      width: 100%;
      background: white;
      border-radius: 24px;
      padding: 3rem 2rem;
      text-align: center;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.25);
      animation: slideInScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .icon-container {
      position: relative;
      width: 100px;
      height: 100px;
      margin: 0 auto 2rem;

      .icon-backdrop {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        border-radius: 50%;
        opacity: 0.15;
        animation: pulse 2s ease-in-out infinite;
      }

      .pending-icon {
        position: relative;
        z-index: 2;
        width: 100%;
        height: 100%;
        color: #f59e0b;
        filter: drop-shadow(0 4px 12px rgba(245, 158, 11, 0.3));
        animation: rotate 3s linear infinite;
      }
    }

    h1 {
      font-size: 2rem;
      font-weight: 800;
      color: #1e293b;
      margin: 0 0 1rem 0;
      letter-spacing: -0.02em;
    }

    .message {
      font-size: 1.125rem;
      color: #64748b;
      margin: 0 0 2rem 0;
      line-height: 1.6;
    }

    .info-box {
      display: flex;
      gap: 1rem;
      padding: 1.25rem;
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      margin-bottom: 2rem;
      text-align: left;

      svg {
        width: 24px;
        height: 24px;
        color: #3b82f6;
        flex-shrink: 0;
        margin-top: 2px;
      }

      p {
        font-size: 0.9375rem;
        color: #475569;
        margin: 0;
        line-height: 1.6;
      }
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.875rem 1.75rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3);

      svg {
        width: 20px;
        height: 20px;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      }

      &:active {
        transform: translateY(0);
      }
    }

    @keyframes slideInScale {
      from {
        opacity: 0;
        transform: translateY(30px) scale(0.9);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.15;
      }
      50% {
        transform: scale(1.1);
        opacity: 0.25;
      }
    }

    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .pending-card {
        padding: 2rem 1.5rem;
      }

      h1 {
        font-size: 1.75rem;
      }

      .message {
        font-size: 1rem;
      }
    }
  `]
})
export class PendingApprovalComponent {
  constructor(private router: Router) {}

  closeWindow() {
    window.close();
    }
}