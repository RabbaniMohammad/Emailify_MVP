import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AdminEventService {
  private refreshPendingCount$ = new Subject<void>();
  private refreshSubject = new Subject<void>();
  private navigationRefreshSubject = new Subject<void>();
  
  // Public observables
  refreshPendingCount = this.refreshPendingCount$.asObservable();
  refresh$ = this.refreshSubject.asObservable();
  navigationRefresh$ = this.navigationRefreshSubject.asObservable();
  
  // Trigger refresh for data changes (approvals, deletions, etc.)
  triggerRefresh(): void {
    this.refreshPendingCount$.next();
    this.refreshSubject.next();
  }

  // Trigger refresh when navigating to admin page
  triggerNavigationRefresh(): void {
    this.navigationRefreshSubject.next();
  }
}