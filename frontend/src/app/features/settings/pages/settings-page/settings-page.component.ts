import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ThemeService, ThemeColors } from '../../../../core/services/theme.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatSnackBarModule
  ],
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss']
})
export class SettingsPageComponent implements OnInit, OnDestroy {
  themes: ThemeColors[] = [];
  currentTheme: ThemeColors | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private themeService: ThemeService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // Get all available themes
    this.themes = this.themeService.getAllThemes();

    // Subscribe to current theme changes
    this.themeService.currentTheme$
      .pipe(takeUntil(this.destroy$))
      .subscribe((theme: ThemeColors) => {
        this.currentTheme = theme;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Apply selected theme
   */
  applyTheme(themeId: string): void {
    this.themeService.setTheme(themeId);
    
    const theme = this.themes.find(t => t.id === themeId);
    this.snackBar.open(`✨ ${theme?.name} theme applied!`, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  /**
   * Check if theme is currently active
   */
  isActiveTheme(themeId: string): boolean {
    return this.currentTheme?.id === themeId;
  }

  /**
   * Get icon for theme
   */
  getThemeIcon(themeId: string): string {
    switch (themeId) {
      case 'oceanBreeze': return 'water';
      case 'sunsetGlow': return 'wb_sunny';
      case 'violetDreams': return 'auto_awesome';
      default: return 'palette';
    }
  }
}
