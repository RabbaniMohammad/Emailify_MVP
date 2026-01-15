import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ToolbarComponent } from './app/shared/components/toolbar/toolbar.component'; // ← Add this
import { CacheMonitorService } from './core/services/cache-monitor.service';
import { ThemeService } from './core/services/theme.service';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet,
    ToolbarComponent  // ← Add this
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  private router = inject(Router);
  private cacheMonitor = inject(CacheMonitorService);
  private themeService = inject(ThemeService);
  private cdr = inject(ChangeDetectorRef);
  showToolbar = true;

  constructor() {
    // ✅ Initialize theme service (loads saved theme or default)
    this.themeService.getCurrentTheme();
    
    // ✅ Set initial toolbar state based on current route
    this.updateToolbarVisibility(this.router.url);
    
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects || event.url;
      this.updateToolbarVisibility(url);
    });
  }
  
  private updateToolbarVisibility(url: string): void {
    const shouldShow = !url.includes('/auth');
    
    if (this.showToolbar !== shouldShow) {
      this.showToolbar = shouldShow;

      // ✅ Force change detection in next tick to ensure UI updates
      setTimeout(() => this.cdr.detectChanges(), 0);
    }
  }

  ngOnInit(): void {
    // Initialize cache monitoring (non-blocking, runs in background)
    this.cacheMonitor.startMonitoring().catch(error => {

    });
  }
}