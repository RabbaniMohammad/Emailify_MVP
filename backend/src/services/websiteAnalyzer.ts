import puppeteer, { Browser, Page } from 'puppeteer';
import logger from 'jet-logger';
import { browserPool } from './browserPool';
import { websiteCache } from './websiteCache';
import { scrapingQueue } from './scrapingQueue';

export interface Product {
  name: string;
  description?: string;
  price?: string;
  image?: string;
  category?: string;
  url?: string;
}

export interface Testimonial {
  text: string;
  author?: string;
  company?: string;
  rating?: number;
}

export interface ContactInfo {
  email?: string;
  phone?: string;
  address?: string;
}

export interface SocialLinks {
  facebook?: string;
  twitter?: string;
  instagram?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
}

export interface CallToAction {
  text: string;
  url: string;
  type: string; // 'button', 'link', 'cta'
}

export interface BrandInfo {
  mission?: string;
  values: string[];
  tagline?: string;
  aboutUs?: string;
}

export interface ContentSection {
  heading?: string;
  paragraphs: string[];
  listItems?: string[]; // Bullet points/list items
  context: string; // e.g., "hero", "about", "features"
}

export interface BrandDNA {
  url: string;
  colors: string[];
  fonts: {
    heading?: string;
    body?: string;
  };
  images: string[];
  content: string[];
  contentSections: ContentSection[]; // Full paragraphs organized by section
  ctas: CallToAction[]; // Call-to-actions with links
  meta: {
    title: string;
    description: string;
  };
  logo?: string;
  products: Product[];
  brandInfo: BrandInfo;
  testimonials: Testimonial[];
  contact: ContactInfo;
  social: SocialLinks;
}

interface AnalyzeOptions {
  timeout?: number;
  maxImages?: number;
  maxContent?: number;
  maxColors?: number;
  maxProducts?: number;
  maxTestimonials?: number;
  maxCTAs?: number;
}

const DEFAULT_OPTIONS: AnalyzeOptions = {
  timeout: 30000,
  maxImages: 50,
  maxContent: 30,
  maxColors: 10,
  maxProducts: 10,
  maxTestimonials: 5,
  maxCTAs: 15
};

/**
 * Validate URL format and security
 */
export function validateUrl(url: string): { valid: boolean; error?: string; normalizedUrl?: string } {
  try {
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const urlObj = new URL(url);

    // Protocol check
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { valid: false, error: 'Only HTTP/HTTPS protocols supported' };
    }

    // Localhost/internal IP check
    const hostname = urlObj.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
    ) {
      return { valid: false, error: 'Cannot analyze local or internal network URLs' };
    }

    return { valid: true, normalizedUrl: urlObj.toString() };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format. Example: https://example.com' };
  }
}

/**
 * Main function to analyze a website and extract brand DNA
 * 
 * Now optimized with:
 * 1. Caching - Returns cached results if available (24hr TTL)
 * 2. Queue - Limits concurrent scrapes to 2 max
 * 3. Browser pooling - Reuses browser instances
 * 4. Memory optimization - Disabled images, optimized flags
 */
export async function analyzeWebsite(url: string, options: AnalyzeOptions = {}): Promise<BrandDNA> {
  // Check cache first
  const cachedResult = websiteCache.get(url);
  if (cachedResult) {
    logger.info(`📦 Returning cached result for: ${url}`);
    return cachedResult;
  }

  // Add to queue to limit concurrency
  return scrapingQueue.add(async () => {
    return analyzeWebsiteInternal(url, options);
  });
}

/**
 * Internal scraping function (uses browser pool)
 */
async function analyzeWebsiteInternal(url: string, options: AnalyzeOptions = {}): Promise<BrandDNA> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    logger.info(`🌐 Starting website analysis for: ${url}`);

    // Acquire browser from pool instead of launching new one
    browser = await browserPool.acquire();

    page = await browser.newPage();

    // Set user agent to avoid bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Set timeouts
    page.setDefaultTimeout(opts.timeout!);
    page.setDefaultNavigationTimeout(opts.timeout!);

    // Navigate to page with retry logic
    await navigateWithRetry(page, url, 3);

    // Wait for page to be ready
    await waitForPageReady(page);

    // Dismiss common pop-ups/modals
    await dismissPopups(page);

    // Check for authentication requirement
    const requiresAuth = await checkAuthRequired(page);
    if (requiresAuth) {
      throw new Error('REQUIRES_AUTH: Website requires authentication');
    }

    // Check for bot detection
    const botDetected = await checkBotDetection(page);
    if (botDetected) {
      throw new Error('BOT_DETECTED: Website has bot protection');
    }

    // Check if page has sufficient content
    const hasContent = await checkPageContent(page);
    if (!hasContent) {
      throw new Error('EMPTY_PAGE: Page has insufficient content');
    }

    // Extract brand DNA
    logger.info('📊 Extracting brand DNA...');
    const brandDNA: BrandDNA = {
      url,
      colors: await extractColors(page, opts.maxColors!),
      fonts: await extractFonts(page),
      images: await extractImages(page, url, opts.maxImages!),
      content: await extractContent(page, opts.maxContent!),
      contentSections: await extractContentSections(page),
      ctas: await extractCTAs(page, url, opts.maxCTAs!),
      meta: await extractMeta(page),
      logo: await extractLogo(page, url),
      products: await extractProducts(page, url, opts.maxProducts!),
      brandInfo: await extractBrandInfo(page),
      testimonials: await extractTestimonials(page, opts.maxTestimonials!),
      contact: await extractContactInfo(page),
      social: await extractSocialLinks(page)
    };

    logger.info(`✅ Website analysis complete - Colors: ${brandDNA.colors.length}, Images: ${brandDNA.images.length}, Content: ${brandDNA.content.length}, CTAs: ${brandDNA.ctas.length}, Products: ${brandDNA.products.length}`);

    // Cache the successful result
    websiteCache.set(url, brandDNA);

    return brandDNA;

  } catch (error: any) {
    logger.info('❌ Website analysis failed: ' + error.message);
    
    // Rethrow custom errors as-is
    if (error.message?.startsWith('REQUIRES_AUTH:') || 
        error.message?.startsWith('BOT_DETECTED:') || 
        error.message?.startsWith('EMPTY_PAGE:')) {
      throw error;
    }

    // Handle specific Puppeteer errors
    if (error.message?.includes('ERR_NAME_NOT_RESOLVED')) {
      throw new Error('DOMAIN_NOT_FOUND: Domain does not exist or cannot be resolved');
    }
    if (error.message?.includes('ERR_CONNECTION_REFUSED')) {
      throw new Error('CONNECTION_REFUSED: Website is unreachable or server is down');
    }
    if (error.message?.includes('ERR_CONNECTION_TIMED_OUT') || error.message?.includes('Navigation timeout')) {
      throw new Error('TIMEOUT: Website took too long to respond');
    }
    if (error.message?.includes('403')) {
      throw new Error('FORBIDDEN: Access to website is forbidden');
    }
    if (error.message?.includes('404')) {
      throw new Error('NOT_FOUND: Page not found');
    }
    if (error.message?.includes('net::ERR_')) {
      throw new Error('NETWORK_ERROR: Network error occurred while accessing website');
    }

    // Generic error
    throw new Error(`Failed to analyze website: ${error.message}`);

  } finally {
    // Cleanup
    if (page) {
      await page.close().catch(() => {});
    }
    if (browser) {
      // Return browser to pool instead of closing it
      await browserPool.release(browser).catch(() => {});
    }
  }
}

/**
 * Navigate to URL with retry logic
 */
async function navigateWithRetry(page: Page, url: string, maxRetries: number): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`🔄 Navigation attempt ${attempt}/${maxRetries}`);
      
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      logger.info('✅ Navigation successful');
      return;

    } catch (error: any) {
      lastError = error;
      logger.info(`⚠️ Navigation attempt ${attempt} failed: ${error.message}`);

      // Don't retry on certain errors
      if (
        error.message?.includes('ERR_NAME_NOT_RESOLVED') ||
        error.message?.includes('ERR_CONNECTION_REFUSED') ||
        error.message?.includes('403') ||
        error.message?.includes('404')
      ) {
        throw error;
      }

      // Exponential backoff
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        logger.info(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Navigation failed after retries');
}

/**
 * Wait for page to be fully ready
 */
async function waitForPageReady(page: Page): Promise<void> {
  try {
    // Wait for network to be idle
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    
    // Wait for DOM content
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve(true);
        } else {
          window.addEventListener('load', () => resolve(true));
          setTimeout(() => resolve(true), 5000);
        }
      });
    });
  } catch (e) {
    logger.info('⚠️ Page ready check had issues, continuing anyway');
  }
}

/**
 * Dismiss common popups and modals
 */
async function dismissPopups(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const selectors = [
        '[class*="cookie"]',
        '[class*="modal"]',
        '[class*="popup"]',
        '[id*="cookie"]',
        '[class*="consent"]',
        '[class*="gdpr"]'
      ];

      selectors.forEach(sel => {
        try {
          const elements = document.querySelectorAll(sel);
          elements.forEach((el: any) => {
            // Try to find and click close button
            const closeBtn = el.querySelector(
              'button[aria-label*="close"], button[aria-label*="Close"], .close, [class*="dismiss"], [class*="accept"]'
            );
            if (closeBtn) {
              (closeBtn as HTMLElement).click();
            }
          });
        } catch (e) {
          // Ignore individual selector errors
        }
      });
    });
  } catch (e) {
    logger.info('⚠️ Popup dismissal had issues, continuing anyway');
  }
}

/**
 * Check if page requires authentication
 */
async function checkAuthRequired(page: Page): Promise<boolean> {
  try {
    const hasPasswordInput = await page.$('input[type="password"]') !== null;
    const hasLoginForm = await page.$('form[action*="login"], form[id*="login"]') !== null;
    return hasPasswordInput || hasLoginForm;
  } catch (e) {
    return false;
  }
}

/**
 * Check for bot detection
 */
async function checkBotDetection(page: Page): Promise<boolean> {
  try {
    const pageContent = await page.content();
    const botKeywords = ['cloudflare', 'just a moment', 'captcha', 'recaptcha', 'hcaptcha', 'bot protection'];
    
    const lowerContent = pageContent.toLowerCase();
    return botKeywords.some(keyword => lowerContent.includes(keyword));
  } catch (e) {
    return false;
  }
}

/**
 * Check if page has sufficient content
 */
async function checkPageContent(page: Page): Promise<boolean> {
  try {
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    return bodyText.trim().length >= 100;
  } catch (e) {
    return false;
  }
}

/**
 * Extract color palette from page
 */
async function extractColors(page: Page, maxColors: number): Promise<string[]> {
  try {
    const colors = await page.evaluate(() => {
      const colorSet = new Set<string>();
      const elements = document.querySelectorAll('*');

      elements.forEach(el => {
        try {
          const computed = window.getComputedStyle(el);
          const color = computed.color;
          const bgColor = computed.backgroundColor;
          const borderColor = computed.borderColor;

          [color, bgColor, borderColor].forEach(c => {
            if (c && !c.includes('rgba(0, 0, 0, 0)') && c !== 'transparent') {
              colorSet.add(c);
            }
          });
        } catch (e) {
          // Ignore errors for individual elements
        }
      });

      return Array.from(colorSet);
    });

    // Normalize colors to hex format
    const normalizedColors = colors
      .map(c => normalizeColor(c))
      .filter((c): c is string => c !== null)
      .filter((c, i, arr) => arr.indexOf(c) === i) // Remove duplicates
      .slice(0, maxColors);

    // Fallback if no colors found
    if (normalizedColors.length === 0) {
      return ['#000000', '#ffffff'];
    }

    return normalizedColors;
  } catch (error) {
    logger.info('⚠️ Color extraction failed');
    return ['#000000', '#ffffff'];
  }
}

/**
 * Normalize color to hex format
 */
function normalizeColor(color: string): string | null {
  try {
    // Already hex
    if (color.startsWith('#')) {
      return color.toLowerCase();
    }

    // RGB/RGBA
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      
      if (r > 255 || g > 255 || b > 255) return null;
      
      return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract fonts from page
 */
async function extractFonts(page: Page): Promise<{ heading?: string; body?: string }> {
  try {
    return await page.evaluate(() => {
      const fonts: { heading?: string; body?: string } = {};

      // Try to get heading font
      const h1 = document.querySelector('h1, h2, h3');
      if (h1) {
        const computed = window.getComputedStyle(h1);
        fonts.heading = computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      }

      // Try to get body font
      const body = document.body;
      if (body) {
        const computed = window.getComputedStyle(body);
        fonts.body = computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      }

      return fonts;
    });
  } catch (error) {
    logger.info('⚠️ Font extraction failed');
    return {};
  }
}

/**
 * Extract images from page
 */
async function extractImages(page: Page, baseUrl: string, maxImages: number): Promise<string[]> {
  try {
    const imageUrls = await page.evaluate(() => {
      const images = new Set<string>();
      
      // 1. Extract from <img> tags (multiple sources)
      const imgElements = document.querySelectorAll('img');
      imgElements.forEach(img => {
        // Filter out tiny images (likely icons/logos)
        const width = img.width || img.naturalWidth || 0;
        const height = img.height || img.naturalHeight || 0;
        
        // Only include images that are reasonably sized (at least 100x100)
        if (width < 100 || height < 100) {
          return;
        }
        
        // Try different attributes
        const sources = [
          img.src,
          img.getAttribute('data-src'),
          img.getAttribute('data-lazy-src'),
          img.getAttribute('data-original'),
          img.getAttribute('data-srcset')?.split(',')[0]?.trim().split(' ')[0]
        ];
        
        sources.forEach(src => {
          if (src && !src.startsWith('data:') && src.length > 10) {
            images.add(src);
          }
        });
      });
      
      // 2. Extract from <picture> and <source> tags
      const pictureElements = document.querySelectorAll('picture source, source[srcset]');
      pictureElements.forEach(source => {
        const srcset = source.getAttribute('srcset');
        if (srcset) {
          const firstSrc = srcset.split(',')[0]?.trim().split(' ')[0];
          if (firstSrc && !firstSrc.startsWith('data:')) {
            images.add(firstSrc);
          }
        }
      });
      
      // 3. Extract background images from CSS (only from large elements)
      const allElements = document.querySelectorAll('section, div, header, main, article');
      allElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        // Only extract bg images from reasonably sized elements
        if (rect.width >= 200 || rect.height >= 200) {
          const style = window.getComputedStyle(el);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none') {
            const urlMatch = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1] && !urlMatch[1].startsWith('data:')) {
              images.add(urlMatch[1]);
            }
          }
        }
      });

      return Array.from(images);
    });

    logger.info(`📸 Found ${imageUrls.length} total image URLs on page`);

    // Filter and validate images
    const validImages: string[] = [];
    for (const imgUrl of imageUrls) {
      try {
        const url = new URL(imgUrl, baseUrl);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          validImages.push(url.toString());
        }
      } catch (e) {
        // Invalid URL, skip
      }
      
      if (validImages.length >= maxImages) break;
    }

    logger.info(`✅ Extracted ${validImages.length} valid images (max: ${maxImages})`);
    return validImages;
  } catch (error) {
    logger.info('⚠️ Image extraction failed');
    return [];
  }
}

/**
 * Extract content snippets from page (includes ALL text-bearing elements)
 */
async function extractContent(page: Page, maxContent: number): Promise<string[]> {
  try {
    return await page.evaluate((max) => {
      const content: string[] = [];

      // Extract headlines
      const headlines = document.querySelectorAll('h1, h2, h3, h4, h5');
      headlines.forEach(h => {
        const text = h.textContent?.trim();
        if (text && text.length > 5 && text.length < 300) {
          content.push(text);
        }
      });

      // Extract CTA texts
      const buttons = document.querySelectorAll('button, a.button, .btn, [class*="cta"]');
      buttons.forEach(btn => {
        const text = btn.textContent?.trim();
        if (text && text.length > 2 && text.length < 100) {
          content.push(text);
        }
      });

      // Extract from paragraphs
      const paragraphs = document.querySelectorAll('p');
      paragraphs.forEach(p => {
        const text = p.textContent?.trim();
        if (text && text.length > 15 && text.length < 500) {
          content.push(text);
        }
      });

      // Extract from spans with substantial content
      const spans = document.querySelectorAll('span');
      spans.forEach(span => {
        const text = span.textContent?.trim();
        // Only standalone spans with good content
        if (text && text.length > 20 && text.length < 300 && !span.querySelector('*')) {
          content.push(text);
        }
      });

      // Extract from divs with direct text (not wrappers)
      const divs = document.querySelectorAll('div');
      divs.forEach(div => {
        const text = Array.from(div.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim())
          .join(' ')
          .trim();
        
        if (text && text.length > 30 && text.length < 500 && content.length < max) {
          content.push(text);
        }
      });

      // Remove duplicates and limit
      return Array.from(new Set(content)).slice(0, max);
    }, maxContent);
  } catch (error) {
    logger.info('⚠️ Content extraction failed');
    return [];
  }
}

/**
 * Extract meta information
 */
async function extractMeta(page: Page): Promise<{ title: string; description: string }> {
  try {
    return await page.evaluate(() => {
      const title = document.title || '';
      const metaDesc = document.querySelector('meta[name="description"]');
      const description = metaDesc?.getAttribute('content') || '';

      return { title, description };
    });
  } catch (error) {
    logger.info('⚠️ Meta extraction failed');
    return { title: '', description: '' };
  }
}

/**
 * Extract logo from page
 */
async function extractLogo(page: Page, baseUrl: string): Promise<string | undefined> {
  try {
    const logoUrl = await page.evaluate(() => {
      // Try multiple selectors for logo
      const logoSelectors = [
        'img[alt*="logo" i]',
        'img[class*="logo" i]',
        'img[id*="logo" i]',
        '.logo img',
        '#logo img',
        'header img:first-child',
        '.header img:first-child',
        '.navbar-brand img',
        'a[href="/"] img',
        '[class*="brand"] img'
      ];

      for (const selector of logoSelectors) {
        const img = document.querySelector(selector) as HTMLImageElement;
        if (img && img.src) {
          // Check if image is reasonably sized for a logo (between 20-300px)
          const width = img.width || img.naturalWidth || 0;
          const height = img.height || img.naturalHeight || 0;
          if (width >= 20 && width <= 300 && height >= 20 && height <= 300) {
            return img.src;
          }
        }
      }

      return null;
    });

    if (logoUrl) {
      const url = new URL(logoUrl, baseUrl);
      logger.info(`🎨 Found logo: ${url.toString()}`);
      return url.toString();
    }

    return undefined;
  } catch (error) {
    logger.info('⚠️ Logo extraction failed');
    return undefined;
  }
}

/**
 * Extract products from page
 */
async function extractProducts(page: Page, baseUrl: string, maxProducts: number): Promise<Product[]> {
  try {
    const products = await page.evaluate((max) => {
      const productList: any[] = [];

      // Try Schema.org Product markup first
      const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
      schemaScripts.forEach(script => {
        try {
          const data = JSON.parse(script.textContent || '');
          if (data['@type'] === 'Product' || (Array.isArray(data) && data.some((item: any) => item['@type'] === 'Product'))) {
            const products = Array.isArray(data) ? data : [data];
            products.forEach((product: any) => {
              if (product['@type'] === 'Product' && productList.length < max) {
                productList.push({
                  name: product.name || '',
                  description: product.description || '',
                  price: product.offers?.price ? `$${product.offers.price}` : undefined,
                  image: product.image || undefined,
                  category: product.category || undefined,
                  url: product.url || undefined
                });
              }
            });
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      });

      // If schema didn't work, try common product selectors
      if (productList.length === 0) {
        const productSelectors = [
          '.product-card',
          '.product-item',
          '[itemtype*="Product"]',
          '.product',
          '[class*="product"]'
        ];

        for (const selector of productSelectors) {
          const productElements = document.querySelectorAll(selector);
          productElements.forEach(el => {
            if (productList.length >= max) return;

            const name = el.querySelector('[class*="title"], [class*="name"], h2, h3')?.textContent?.trim();
            const description = el.querySelector('[class*="desc"], p')?.textContent?.trim();
            const priceEl = el.querySelector('[class*="price"], [itemprop="price"]');
            const price = priceEl?.textContent?.trim();
            const imgEl = el.querySelector('img') as HTMLImageElement;
            const image = imgEl?.src;

            if (name) {
              productList.push({
                name,
                description: description?.substring(0, 200),
                price,
                image,
                category: undefined,
                url: undefined
              });
            }
          });

          if (productList.length > 0) break;
        }
      }

      return productList.slice(0, max);
    }, maxProducts);

    logger.info(`🛍️ Extracted ${products.length} products`);
    return products;
  } catch (error) {
    logger.info('⚠️ Product extraction failed');
    return [];
  }
}

/**
 * Extract brand info (mission, values, about)
 */
async function extractBrandInfo(page: Page): Promise<BrandInfo> {
  try {
    const brandInfo = await page.evaluate(() => {
      const info: any = {
        mission: undefined,
        values: [],
        tagline: undefined,
        aboutUs: undefined
      };

      // Extract tagline (usually in hero section or header)
      const taglineSelectors = [
        'h1 + p',
        '.hero p',
        '.tagline',
        '[class*="subtitle"]',
        '.lead'
      ];

      for (const selector of taglineSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
          const text = el.textContent.trim();
          if (text.length > 10 && text.length < 200) {
            info.tagline = text;
            break;
          }
        }
      }

      // Extract mission/about (look for keywords)
      const allParagraphs = document.querySelectorAll('p');
      allParagraphs.forEach(p => {
        const text = p.textContent?.trim() || '';
        const lowerText = text.toLowerCase();

        // Look for mission statement
        if (!info.mission && (
          lowerText.includes('our mission') ||
          lowerText.includes('we believe') ||
          lowerText.includes('our purpose')
        )) {
          if (text.length > 30 && text.length < 500) {
            info.mission = text;
          }
        }

        // Look for about us
        if (!info.aboutUs && (
          lowerText.includes('about us') ||
          lowerText.includes('who we are') ||
          lowerText.includes('our story')
        )) {
          if (text.length > 50 && text.length < 500) {
            info.aboutUs = text;
          }
        }
      });

      // Extract values (look for lists)
      const valueLists = document.querySelectorAll('[class*="value"], [class*="principle"]');
      valueLists.forEach(el => {
        const items = el.querySelectorAll('li, h3, h4');
        items.forEach(item => {
          const text = item.textContent?.trim();
          if (text && text.length > 3 && text.length < 50 && info.values.length < 5) {
            info.values.push(text);
          }
        });
      });

      return info;
    });

    logger.info(`💡 Extracted brand info: ${brandInfo.mission ? 'has mission' : 'no mission'}, ${brandInfo.values.length} values`);
    return brandInfo;
  } catch (error) {
    logger.info('⚠️ Brand info extraction failed');
    return { mission: undefined, values: [], tagline: undefined, aboutUs: undefined };
  }
}

/**
 * Extract testimonials
 */
async function extractTestimonials(page: Page, maxTestimonials: number): Promise<Testimonial[]> {
  try {
    const testimonials = await page.evaluate((max) => {
      const testimonialList: any[] = [];

      // Try Schema.org Review markup first
      const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
      schemaScripts.forEach(script => {
        try {
          const data = JSON.parse(script.textContent || '');
          if (data.review || data.Review) {
            const reviews = Array.isArray(data.review) ? data.review : [data.review];
            reviews.forEach((review: any) => {
              if (testimonialList.length < max) {
                testimonialList.push({
                  text: review.reviewBody || review.description || '',
                  author: review.author?.name || review.author || undefined,
                  rating: review.reviewRating?.ratingValue || undefined,
                  company: undefined
                });
              }
            });
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      });

      // Try common testimonial selectors
      if (testimonialList.length === 0) {
        const testimonialSelectors = [
          '.testimonial',
          '[class*="testimonial"]',
          '.review',
          '[class*="review"]',
          '.quote',
          'blockquote'
        ];

        for (const selector of testimonialSelectors) {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            if (testimonialList.length >= max) return;

            const text = el.querySelector('p, .text, [class*="text"]')?.textContent?.trim() ||
                        el.textContent?.trim();
            const author = el.querySelector('.author, [class*="author"], cite')?.textContent?.trim();
            const company = el.querySelector('.company, [class*="company"]')?.textContent?.trim();

            if (text && text.length > 20 && text.length < 500) {
              testimonialList.push({
                text,
                author,
                company,
                rating: undefined
              });
            }
          });

          if (testimonialList.length > 0) break;
        }
      }

      return testimonialList.slice(0, max);
    }, maxTestimonials);

    logger.info(`💬 Extracted ${testimonials.length} testimonials`);
    return testimonials;
  } catch (error) {
    logger.info('⚠️ Testimonial extraction failed');
    return [];
  }
}

/**
 * Extract contact information
 */
async function extractContactInfo(page: Page): Promise<ContactInfo> {
  try {
    const contact = await page.evaluate(() => {
      const info: any = {
        email: undefined,
        phone: undefined,
        address: undefined
      };

      const bodyText = document.body.innerText;

      // Extract email
      const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        info.email = emailMatch[0];
      }

      // Extract phone (various formats)
      const phoneMatch = bodyText.match(/(\+\d{1,3}[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}/);
      if (phoneMatch) {
        info.phone = phoneMatch[0];
      }

      // Extract address (look for address elements)
      const addressEl = document.querySelector('address, [class*="address"], [itemprop="address"]');
      if (addressEl) {
        info.address = addressEl.textContent?.trim().substring(0, 200);
      }

      return info;
    });

    logger.info(`📞 Extracted contact: ${contact.email ? 'email' : 'no email'}, ${contact.phone ? 'phone' : 'no phone'}`);
    return contact;
  } catch (error) {
    logger.info('⚠️ Contact info extraction failed');
    return {};
  }
}

/**
 * Extract social media links
 */
async function extractSocialLinks(page: Page): Promise<SocialLinks> {
  try {
    const social = await page.evaluate(() => {
      const links: any = {};

      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = (link as HTMLAnchorElement).href.toLowerCase();

        if (href.includes('facebook.com/') && !links.facebook) {
          links.facebook = (link as HTMLAnchorElement).href;
        } else if (href.includes('twitter.com/') && !links.twitter) {
          links.twitter = (link as HTMLAnchorElement).href;
        } else if (href.includes('instagram.com/') && !links.instagram) {
          links.instagram = (link as HTMLAnchorElement).href;
        } else if (href.includes('linkedin.com/') && !links.linkedin) {
          links.linkedin = (link as HTMLAnchorElement).href;
        } else if (href.includes('youtube.com/') && !links.youtube) {
          links.youtube = (link as HTMLAnchorElement).href;
        } else if (href.includes('tiktok.com/') && !links.tiktok) {
          links.tiktok = (link as HTMLAnchorElement).href;
        }
      });

      return links;
    });

    const count = Object.keys(social).length;
    logger.info(`🔗 Extracted ${count} social links`);
    return social;
  } catch (error) {
    logger.info('⚠️ Social links extraction failed');
    return {};
  }
}

/**
 * Extract CTAs (Call-to-Actions) with links
 */
async function extractCTAs(page: Page, baseUrl: string, maxCTAs: number): Promise<CallToAction[]> {
  try {
    const ctas = await page.evaluate((max) => {
      const ctaList: any[] = [];

      // Selectors for common CTA elements
      const ctaSelectors = [
        'button[href], a.button, .btn, .cta, [class*="cta"]',
        'a[class*="button"]',
        '[role="button"]',
        'a[class*="action"]',
        '[class*="get-started"]',
        '[class*="sign-up"]',
        '[class*="book"]',
        '[class*="contact"]',
        '[class*="learn-more"]',
        '[class*="demo"]',
        'a[class*="primary"]'
      ];

      const processedUrls = new Set<string>();

      for (const selector of ctaSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (ctaList.length >= max) return;

          const text = el.textContent?.trim();
          let url = '';

          // Try multiple methods to get URL
          // ✅ IMPORTANT: Use getAttribute for ALL cases to get raw URL (will convert to absolute later)
          
          // 1. href attribute (anchor or any element)
          if (el.hasAttribute('href')) {
            url = el.getAttribute('href') || '';
          } 
          // 2. Angular routerLink (case-insensitive)
          else if (el.hasAttribute('routerlink')) {
            url = el.getAttribute('routerlink') || '';
          }
          else if (el.hasAttribute('routerLink')) {
            url = el.getAttribute('routerLink') || '';
          }
          else if (el.hasAttribute('ng-reflect-router-link')) {
            url = el.getAttribute('ng-reflect-router-link') || '';
          }
          // 3. Button wrapped in anchor tag or routerLink
          else if (el.closest('a')) {
            const anchor = el.closest('a') as HTMLAnchorElement;
            url = anchor.getAttribute('href') || anchor.getAttribute('routerlink') || anchor.getAttribute('routerLink') || '';
          }
          // 4. data-href or data-url attributes
          else if (el.hasAttribute('data-href')) {
            url = el.getAttribute('data-href') || '';
          }
          else if (el.hasAttribute('data-url')) {
            url = el.getAttribute('data-url') || '';
          }
          else if (el.hasAttribute('data-link')) {
            url = el.getAttribute('data-link') || '';
          }
          // 5. formaction for submit buttons
          else if (el.hasAttribute('formaction')) {
            url = el.getAttribute('formaction') || '';
          }
          // 6. onclick with location/window.open/navigate
          else if (el.hasAttribute('onclick')) {
            const onclick = el.getAttribute('onclick') || '';
            // Match various patterns
            const patterns = [
              /(?:location\.href|window\.location\.href)\s*=\s*['"]([^'"]+)['"]/i,
              /(?:location|window\.location)\s*=\s*['"]([^'"]+)['"]/i,
              /window\.open\s*\(\s*['"]([^'"]+)['"]/i,
              /navigate\s*\(\s*['"]([^'"]+)['"]/i,
              /router\.navigate\s*\(\s*\[['"]([^'"]+)['"]\]/i
            ];
            
            for (const pattern of patterns) {
              const match = onclick.match(pattern);
              if (match) {
                url = match[1];
                break;
              }
            }
          }
          // 7. Check for @click, v-on:click (Vue), (click) (Angular) in attributes
          else if (el.hasAttribute('@click') || el.hasAttribute('v-on:click') || el.hasAttribute('(click)')) {
            const clickAttr = el.getAttribute('@click') || el.getAttribute('v-on:click') || el.getAttribute('(click)') || '';
            const urlMatch = clickAttr.match(/['"]([^'"]*\/[^'"]+)['"]/);
            if (urlMatch) {
              url = urlMatch[1];
            }
          }

          // ✅ SKIP: Don't include relative URLs - they'll be converted after page.evaluate returns
          // We can't convert to absolute inside page.evaluate because we don't have access to baseUrl there

          // Validate (allow relative URLs for now, will be converted later)
          if (
            text && 
            text.length > 2 && 
            text.length < 100 && 
            url && 
            !url.startsWith('javascript:') &&
            !url.startsWith('mailto:') &&
            !url.startsWith('tel:') &&
            !url.startsWith('#') &&
            !processedUrls.has(url)
          ) {
            ctaList.push({
              text,
              url, // Keep as-is (relative or absolute)
              type: el.tagName === 'BUTTON' ? 'button' : 'link'
            });
            processedUrls.add(url);
          }
        });
      }

      return ctaList.slice(0, max);
    }, maxCTAs);

    // ✅ Convert all relative URLs to absolute URLs
    const absoluteCTAs = ctas.map(cta => {
      const originalUrl = cta.url;
      let absoluteUrl = cta.url;
      
      // If URL is relative (starts with / or doesn't have protocol)
      if (absoluteUrl && !absoluteUrl.startsWith('http')) {
        try {
          // Create absolute URL from baseUrl
          const base = new URL(baseUrl);
          
          // Handle different relative URL formats
          if (absoluteUrl.startsWith('//')) {
            // Protocol-relative URL: //example.com/path
            absoluteUrl = base.protocol + absoluteUrl;
          } else if (absoluteUrl.startsWith('/')) {
            // Root-relative URL: /path
            absoluteUrl = `${base.protocol}//${base.host}${absoluteUrl}`;
          } else {
            // Path-relative URL: path/to/page
            absoluteUrl = `${base.protocol}//${base.host}/${absoluteUrl}`;
          }
          
          logger.info(`🔗 Converted URL: "${originalUrl}" → "${absoluteUrl}"`);
        } catch (error) {
          logger.warn(`⚠️ Failed to convert relative URL to absolute: ${cta.url}`);
          // Keep original URL if conversion fails
        }
      }
      
      return {
        ...cta,
        url: absoluteUrl
      };
    });

    logger.info(`🎯 Extracted ${absoluteCTAs.length} CTAs with links (${absoluteCTAs.filter(c => !c.url.startsWith('http')).length} still relative)`);
    
    // ✅ Log any remaining relative URLs for debugging
    const stillRelative = absoluteCTAs.filter(c => !c.url.startsWith('http'));
    if (stillRelative.length > 0) {
      logger.warn(`⚠️ Found ${stillRelative.length} CTAs with relative URLs: ${stillRelative.map(c => c.url).join(', ')}`);
    }
    
    return absoluteCTAs;
  } catch (error) {
    logger.info('⚠️ CTA extraction failed');
    return [];
  }
}

/**
 * Extract full content sections with paragraphs
 */
async function extractContentSections(page: Page): Promise<ContentSection[]> {
  try {
    const sections = await page.evaluate(() => {
      const contentSections: any[] = [];

      // 1. Extract Hero Section
      const heroSelectors = ['.hero', '[class*="hero"]', 'header section', 'main > section:first-child', '.banner'];
      for (const selector of heroSelectors) {
        const hero = document.querySelector(selector);
        if (hero) {
          const heading = hero.querySelector('h1, h2')?.textContent?.trim();
          const paragraphs: string[] = [];
          const listItems: string[] = [];
          
          // Extract from <p> tags
          hero.querySelectorAll('p').forEach(p => {
            const text = p.textContent?.trim();
            if (text && text.length > 15) {
              paragraphs.push(text);
            }
          });

          // Extract from spans with substantial text
          hero.querySelectorAll('span').forEach(span => {
            const text = span.textContent?.trim();
            // Only if span has direct text content and reasonable length
            if (text && text.length > 30 && text.length < 500 && !span.querySelector('*')) {
              paragraphs.push(text);
            }
          });

          // Extract list items
          hero.querySelectorAll('ul li, ol li').forEach(li => {
            const text = li.textContent?.trim();
            if (text && text.length > 5 && text.length < 300) {
              listItems.push(text);
            }
          });

          if (heading || paragraphs.length > 0 || listItems.length > 0) {
            contentSections.push({
              heading,
              paragraphs: paragraphs.slice(0, 5),
              listItems: listItems.length > 0 ? listItems.slice(0, 10) : undefined,
              context: 'hero'
            });
            break;
          }
        }
      }

      // 2. Extract Features/Services Sections
      const featureSections = document.querySelectorAll('[class*="feature"], [class*="service"], [id*="feature"], [id*="service"]');
      featureSections.forEach(section => {
        if (contentSections.length >= 8) return;
        
        const heading = section.querySelector('h2, h3, h4')?.textContent?.trim();
        const paragraphs: string[] = [];
        const listItems: string[] = [];
        
        // Extract from <p> tags
        section.querySelectorAll('p').forEach(p => {
          const text = p.textContent?.trim();
          if (text && text.length > 20 && text.length < 1000) {
            paragraphs.push(text);
          }
        });

        // Extract from <span> and <div> that have substantial text (not just wrappers)
        section.querySelectorAll('span, div').forEach(el => {
          // Only get direct text content, not nested
          const text = Array.from(el.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent?.trim())
            .join(' ')
            .trim();
          
          if (text && text.length > 30 && text.length < 1000 && paragraphs.length < 5) {
            paragraphs.push(text);
          }
        });

        // Extract list items from features
        section.querySelectorAll('ul li, ol li').forEach(li => {
          const text = li.textContent?.trim();
          if (text && text.length > 5 && text.length < 300) {
            listItems.push(text);
          }
        });

        if ((heading || paragraphs.length > 0 || listItems.length > 0) && (paragraphs.length > 0 || listItems.length > 0)) {
          contentSections.push({
            heading,
            paragraphs: paragraphs.slice(0, 3),
            listItems: listItems.length > 0 ? listItems.slice(0, 10) : undefined,
            context: 'features'
          });
        }
      });

      // 3. Extract About Section
      const aboutSelectors = ['[class*="about"]', '[id*="about"]', 'section:has(h2:contains("About"))'];
      for (const selector of aboutSelectors) {
        const about = document.querySelector(selector);
        if (about && contentSections.filter(s => s.context === 'about').length === 0) {
          const heading = about.querySelector('h1, h2, h3')?.textContent?.trim();
          const paragraphs: string[] = [];
          const listItems: string[] = [];
          
          // Extract from <p> tags
          about.querySelectorAll('p').forEach(p => {
            const text = p.textContent?.trim();
            if (text && text.length > 20 && text.length < 1000) {
              paragraphs.push(text);
            }
          });

          // Extract from spans and divs with text
          about.querySelectorAll('span, div').forEach(el => {
            const text = Array.from(el.childNodes)
              .filter(node => node.nodeType === Node.TEXT_NODE)
              .map(node => node.textContent?.trim())
              .join(' ')
              .trim();
            
            if (text && text.length > 30 && text.length < 1000 && paragraphs.length < 5) {
              paragraphs.push(text);
            }
          });

          // Extract list items
          about.querySelectorAll('ul li, ol li').forEach(li => {
            const text = li.textContent?.trim();
            if (text && text.length > 5 && text.length < 300) {
              listItems.push(text);
            }
          });

          if (paragraphs.length > 0 || listItems.length > 0) {
            contentSections.push({
              heading,
              paragraphs: paragraphs.slice(0, 5),
              listItems: listItems.length > 0 ? listItems.slice(0, 10) : undefined,
              context: 'about'
            });
            break;
          }
        }
      }

      // 4. Extract main content paragraphs if we don't have much yet
      if (contentSections.length < 3) {
        const mainParagraphs: string[] = [];
        const mainListItems: string[] = [];
        
        // Get paragraphs
        const allParagraphs = document.querySelectorAll('main p, article p, section p, .content p');
        allParagraphs.forEach(p => {
          const text = p.textContent?.trim();
          if (text && text.length > 30 && text.length < 1000 && mainParagraphs.length < 10) {
            mainParagraphs.push(text);
          }
        });

        // Get list items
        const allListItems = document.querySelectorAll('main ul li, main ol li, article ul li, section ul li');
        allListItems.forEach(li => {
          const text = li.textContent?.trim();
          if (text && text.length > 5 && text.length < 300 && mainListItems.length < 20) {
            mainListItems.push(text);
          }
        });

        // Get text from divs and spans with substantial content
        const textElements = document.querySelectorAll('main div, main span, article div, section div');
        textElements.forEach(el => {
          if (mainParagraphs.length >= 10) return;
          
          // Only direct text content
          const text = Array.from(el.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent?.trim())
            .join(' ')
            .trim();
          
          if (text && text.length > 30 && text.length < 1000) {
            mainParagraphs.push(text);
          }
        });

        if (mainParagraphs.length > 0 || mainListItems.length > 0) {
          contentSections.push({
            heading: 'Main Content',
            paragraphs: mainParagraphs.slice(0, 5),
            listItems: mainListItems.length > 0 ? mainListItems.slice(0, 15) : undefined,
            context: 'main'
          });
        }
      }

      return contentSections.slice(0, 10); // Max 10 sections
    });

    logger.info(`📝 Extracted ${sections.length} content sections with full paragraphs`);
    return sections;
  } catch (error) {
    logger.info('⚠️ Content sections extraction failed');
    return [];
  }
}

