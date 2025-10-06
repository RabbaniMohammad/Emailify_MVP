import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AdminEventService {
  private refreshPendingCount$ = new Subject<void>();
  private refreshSubject = new Subject<void>();
  
  refreshPendingCount = this.refreshPendingCount$.asObservable();
  refresh$ = this.refreshSubject.asObservable();
  
  triggerRefresh(): void {
    this.refreshPendingCount$.next();
    this.refreshSubject.next();
  }
}