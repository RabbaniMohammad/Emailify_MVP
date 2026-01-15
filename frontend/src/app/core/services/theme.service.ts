import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ThemeColors {
  id: string;
  name: string;
  description: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  gradient: string;
}

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_STORAGE_KEY = 'camply-theme';
  private currentThemeSubject: BehaviorSubject<ThemeColors>;
  public currentTheme$: Observable<ThemeColors>;

  // 🎨 Theme Options
  private readonly themes: Record<string, ThemeColors> = {
    oceanBreeze: {
      id: 'oceanBreeze',
      name: 'Ocean Breeze',
      description: 'Professional, Fresh, Trustworthy',
      primary: '#3b82f6',       // Bright Blue
      secondary: '#06b6d4',     // Cyan
      accent: '#10b981',        // Emerald Green
      background: '#ffffff',
      surface: '#f0f9ff',       // Light Blue Tint
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
      gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)'
    },
    sunsetGlow: {
      id: 'sunsetGlow',
      name: 'Sunset Glow',
      description: 'Warm, Creative, Energetic',
      primary: '#f59e0b',       // Warm Orange/Amber
      secondary: '#fb923c',     // Coral Orange
      accent: '#8b5cf6',        // Bright Purple
      background: '#ffffff',
      surface: '#fff7ed',       // Warm Peach Tint
      textPrimary: '#111827',
      textSecondary: '#78350f',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#f59e0b',
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #fb923c 100%)'
    },
    violetDreams: {
      id: 'violetDreams',
      name: 'Violet Dreams',
      description: 'Modern, Premium, Sophisticated',
      primary: '#8b5cf6',       // Light Violet
      secondary: '#a78bfa',     // Lighter Purple
      accent: '#fbbf24',        // Golden Yellow
      background: '#ffffff',
      surface: '#faf5ff',       // Very Light Lavender
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      success: '#10b981',
      warning: '#fbbf24',
      error: '#ef4444',
      info: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)'
    }
  };

  constructor() {
    // Load saved theme or default to Ocean Breeze
    const savedThemeId = localStorage.getItem(this.THEME_STORAGE_KEY) || 'oceanBreeze';
    const initialTheme = this.themes[savedThemeId] || this.themes['oceanBreeze'];
    
    this.currentThemeSubject = new BehaviorSubject<ThemeColors>(initialTheme);
    this.currentTheme$ = this.currentThemeSubject.asObservable();

    // Apply theme on initialization
    this.applyTheme(initialTheme);
  }

  /**
   * Get all available themes
   */
  getAllThemes(): ThemeColors[] {
    return Object.values(this.themes);
  }

  /**
   * Get current active theme
   */
  getCurrentTheme(): ThemeColors {
    return this.currentThemeSubject.value;
  }

  /**
   * Switch to a different theme
   */
  setTheme(themeId: string): void {
    const theme = this.themes[themeId];
    if (!theme) {
      console.error(`Theme '${themeId}' not found`);
      return;
    }

    this.applyTheme(theme);
    this.currentThemeSubject.next(theme);
    localStorage.setItem(this.THEME_STORAGE_KEY, themeId);
  }

  /**
   * Apply theme by updating CSS custom properties
   */
  private applyTheme(theme: ThemeColors): void {
    const root = document.documentElement;

    // Set CSS custom properties
    root.style.setProperty('--theme-primary', theme.primary);
    root.style.setProperty('--theme-secondary', theme.secondary);
    root.style.setProperty('--theme-accent', theme.accent);
    root.style.setProperty('--theme-background', theme.background);
    root.style.setProperty('--theme-surface', theme.surface);
    root.style.setProperty('--theme-text-primary', theme.textPrimary);
    root.style.setProperty('--theme-text-secondary', theme.textSecondary);
    root.style.setProperty('--theme-success', theme.success);
    root.style.setProperty('--theme-warning', theme.warning);
    root.style.setProperty('--theme-error', theme.error);
    root.style.setProperty('--theme-info', theme.info);
    root.style.setProperty('--theme-gradient', theme.gradient);

    // Also update legacy variables for backward compatibility
    root.style.setProperty('--primary-purple', theme.primary);
    root.style.setProperty('--primary-purple-dark', this.darkenColor(theme.primary));
    root.style.setProperty('--accent-pink', theme.accent);
    root.style.setProperty('--gradient-primary', theme.gradient);
  }

  /**
   * Darken a color by 10% (simple approximation)
   */
  private darkenColor(hex: string): string {
    // Simple darkening - subtract 20 from each RGB component
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;
    
    const r = Math.max(0, rgb.r - 30);
    const g = Math.max(0, rgb.g - 30);
    const b = Math.max(0, rgb.b - 30);
    
    return this.rgbToHex(r, g, b);
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
}
