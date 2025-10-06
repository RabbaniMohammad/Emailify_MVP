import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AdminEventService {
  private refreshPendingCount$ = new Subject<void>();
  
  refreshPendingCount = this.refreshPendingCount$.asObservable();
  
  triggerRefresh(): void {
    this.refreshPendingCount$.next();
  }
}