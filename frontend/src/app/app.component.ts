import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ToolbarComponent } from './app/shared/components/toolbar/toolbar.component'; // ← Add this
import { CacheMonitorService } from './core/services/cache-monitor.service';


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
  showToolbar = true;

  constructor() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.showToolbar = !event.url.includes('/auth');
    });
  }

  ngOnInit(): void {
    // Initialize cache monitoring (non-blocking, runs in background)
    this.cacheMonitor.startMonitoring().catch(error => {
      console.error('❌ [APP] Cache monitoring failed to start:', error);
    });
  }
}