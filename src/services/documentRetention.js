const AWS = require('aws-sdk');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { Document } = require('../models/Document');
const { logger } = require('../utils/logger');
const { cacheHelpers } = require('../config/redis');

class DocumentRetentionService {
  constructor() {
    this.initializeStorage();
    this.encryptionAlgorithm = 'aes-256-gcm';
    this.encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    
    // Configure for DigitalOcean Spaces (S3-compatible)
    this.spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com');
    
    this.s3 = new AWS.S3({
      endpoint: this.spacesEndpoint,
      accessKeyId: process.env.DO_SPACES_KEY || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.DO_SPACES_SECRET || process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.DO_SPACES_REGION || process.env.AWS_REGION || 'nyc3',
      s3ForcePathStyle: false,
      signatureVersion: 'v4'
    });
    
    this.bucketName = process.env.DO_SPACES_BUCKET || process.env.AWS_S3_BUCKET || 'medicare-compliance-docs';
    
    // Ensure bucket exists
    this.ensureBucketExists();
  }
  
  async initializeStorage() {
    try {
      logger.info('🗄️  Initializing document retention storage system');
      
      // Check if using DigitalOcean Spaces or AWS S3
      const storageProvider = process.env.DO_SPACES_KEY ? 'DigitalOcean Spaces' : 'AWS S3';
      logger.info(`📦 Storage Provider: ${storageProvider}`);
      
    } catch (error) {
      logger.error('❌ Error initializing storage:', error);
      throw error;
    }
  }
  
  async ensureBucketExists() {
    try {
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      logger.info(`✅ Storage bucket '${this.bucketName}' verified`);
    } catch (error) {
      if (error.statusCode === 404) {
        logger.info(`🔨 Creating storage bucket: ${this.bucketName}`);
        await this.s3.createBucket({ 
          Bucket: this.bucketName,
          CreateBucketConfiguration: {
            LocationConstraint: process.env.DO_SPACES_REGION || 'nyc3'
          }
        }).promise();
        
        // Set bucket policy for compliance
        await this.setBucketCompliance();
      } else {
        logger.error('❌ Error checking bucket:', error);
        throw error;
      }
    }
  }
  
  async setBucketCompliance() {
    try {
      // Enable versioning for audit trail
      await this.s3.putBucketVersioning({
        Bucket: this.bucketName,
        VersioningConfiguration: {
          Status: 'Enabled'
        }
      }).promise();
      
      // Set server-side encryption
      await this.s3.putBucketEncryption({
        Bucket: this.bucketName,
        ServerSideEncryptionConfiguration: {
          Rules: [{
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256'
            },
            BucketKeyEnabled: true
          }]
        }
      }).promise();
      
      // Set lifecycle policy for automatic retention management
      await this.s3.putBucketLifecycleConfiguration({
        Bucket: this.bucketName,
        LifecycleConfiguration: {
          Rules: [{
            Id: 'ComplianceRetentionRule',
            Status: 'Enabled',
            Filter: { Prefix: 'compliance/' },
            Transitions: [
              {
                Days: 90,
                StorageClass: 'STANDARD_IA'
              },
              {
                Days: 365,
                StorageClass: 'GLACIER'
              }
            ]
          }]
        }
      }).promise();
      
      logger.info('✅ Bucket compliance configuration applied');
    } catch (error) {
      logger.error('⚠️ Error setting bucket compliance:', error);
    }
  }
  
  async storeDocument(fileBuffer, metadata) {
    try {
      logger.info(`📁 Storing document: ${metadata.fileName}`);
      
      // Generate unique storage path
      const documentId = this.generateDocumentId(metadata);
      const storagePath = this.generateStoragePath(documentId, metadata);
      
      // Encrypt document if required
      let finalBuffer = fileBuffer;
      let encryptionMetadata = null;
      
      if (metadata.encrypt !== false) {
        const encrypted = this.encryptBuffer(fileBuffer);
        finalBuffer = encrypted.encryptedData;
        encryptionMetadata = {
          algorithm: this.encryptionAlgorithm,
          iv: encrypted.iv.toString('hex'),
          authTag: encrypted.authTag.toString('hex')
        };
      }
      
      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(finalBuffer).digest('hex');
      
      // Prepare S3 upload parameters
      const uploadParams = {
        Bucket: this.bucketName,
        Key: storagePath,
        Body: finalBuffer,
        ContentType: metadata.mimeType || 'application/octet-stream',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'document-id': documentId,
          'document-type': metadata.documentType,
          'category': metadata.category,
          'created-by': metadata.createdBy,
          'retention-years': metadata.retentionYears?.toString() || '10',
          'checksum': checksum,
          'original-filename': metadata.fileName,
          ...encryptionMetadata
        },
        Tagging: this.generateTags(metadata)
      };
      
      // Upload to storage
      const uploadResult = await this.s3.upload(uploadParams).promise();
      
      // Create database record
      const document = await Document.create({
        document_type: metadata.documentType,
        category: metadata.category,
        title: metadata.title || metadata.fileName,
        description: metadata.description,
        file_name: metadata.fileName,
        file_size: fileBuffer.length,
        mime_type: metadata.mimeType,
        storage_location: process.env.DO_SPACES_KEY ? 'DIGITALOCEAN_SPACES' : 'S3',
        storage_path: storagePath,
        storage_bucket: this.bucketName,
        encryption_status: metadata.encrypt !== false,
        encryption_algorithm: encryptionMetadata?.algorithm,
        checksum,
        retention_years: metadata.retentionYears || 10,
        related_entity_type: metadata.relatedEntityType,
        related_entity_id: metadata.relatedEntityId,
        beneficiary_id: metadata.beneficiaryId,
        employee_id: metadata.employeeId,
        created_by: metadata.createdBy,
        tags: metadata.tags || [],
        metadata: {
          originalSize: fileBuffer.length,
          storageUrl: uploadResult.Location,
          versionId: uploadResult.VersionId,
          etag: uploadResult.ETag,
          ...metadata.additionalMetadata
        }
      });
      
      logger.info(`✅ Document stored successfully: ${document.document_id}`);
      
      // Update cache
      await cacheHelpers.setWithExpiry(
        `document:${document.id}`,
        document.toJSON(),
        3600
      );
      
      return document;
      
    } catch (error) {
      logger.error('❌ Error storing document:', error);
      throw error;
    }
  }
  
  async retrieveDocument(documentId, options = {}) {
    try {
      logger.info(`📖 Retrieving document: ${documentId}`);
      
      // Check cache first
      const cached = await cacheHelpers.getCached(
        `document:${documentId}`,
        async () => {
          return await Document.findOne({
            where: { 
              [options.useUUID ? 'id' : 'document_id']: documentId 
            }
          });
        }
      );
      
      if (!cached) {
        throw new Error(`Document not found: ${documentId}`);
      }
      
      const document = cached;
      
      // Check if document retrieval is allowed
      if (document.legal_hold && !options.bypassLegalHold) {
        logger.warn(`⚠️ Document ${documentId} is under legal hold`);
      }
      
      // Get document from storage
      const getParams = {
        Bucket: this.bucketName,
        Key: document.storage_path
      };
      
      const storageResult = await this.s3.getObject(getParams).promise();
      let documentBuffer = storageResult.Body;
      
      // Decrypt if encrypted
      if (document.encryption_status) {
        const encryptionMeta = document.metadata;
        documentBuffer = this.decryptBuffer(documentBuffer, {
          iv: Buffer.from(encryptionMeta.iv, 'hex'),
          authTag: Buffer.from(encryptionMeta.authTag, 'hex')
        });
      }
      
      // Verify integrity
      const calculatedChecksum = crypto.createHash('sha256')
        .update(documentBuffer)
        .digest('hex');
        
      if (calculatedChecksum !== document.checksum) {
        throw new Error(`Document integrity check failed: ${documentId}`);
      }
      
      // Update access tracking
      await document.update({
        last_accessed: new Date(),
        access_count: document.access_count + 1
      });
      
      logger.info(`✅ Document retrieved successfully: ${documentId}`);
      
      return {
        document,
        buffer: documentBuffer,
        metadata: {
          fileName: document.file_name,
          mimeType: document.mime_type,
          size: document.file_size,
          checksum: document.checksum
        }
      };
      
    } catch (error) {
      logger.error(`❌ Error retrieving document ${documentId}:`, error);
      throw error;
    }
  }
  
  async searchDocuments(query, options = {}) {
    try {
      logger.info(`🔍 Searching documents with query: "${query}"`);
      
      const searchResults = await Document.searchDocuments(query, {
        type: options.type,
        category: options.category,
        startDate: options.startDate,
        endDate: options.endDate,
        tags: options.tags,
        beneficiaryId: options.beneficiaryId,
        employeeId: options.employeeId,
        limit: options.limit || 100,
        offset: options.offset || 0
      });
      
      // Cache search results
      const cacheKey = `search:${Buffer.from(JSON.stringify({ query, options })).toString('base64')}`;
      await cacheHelpers.setWithExpiry(cacheKey, searchResults, 300); // 5 minutes
      
      logger.info(`📊 Search completed: ${searchResults.count} documents found`);
      
      return searchResults;
      
    } catch (error) {
      logger.error('❌ Error searching documents:', error);
      throw error;
    }
  }
  
  async scheduleDocumentDisposal() {
    try {
      logger.info('🗑️  Running scheduled document disposal process');
      
      const documentsForDisposal = await Document.getDocumentsForDisposal();
      
      if (documentsForDisposal.length === 0) {
        logger.info('✅ No documents scheduled for disposal');
        return { disposed: 0 };
      }
      
      let disposedCount = 0;
      
      for (const document of documentsForDisposal) {
        try {
          // Double-check legal hold status
          if (document.legal_hold) {
            logger.warn(`⚠️ Skipping disposal - document ${document.document_id} under legal hold`);
            continue;
          }
          
          // Delete from storage
          await this.s3.deleteObject({
            Bucket: this.bucketName,
            Key: document.storage_path
          }).promise();
          
          // Mark as disposed in database (soft delete)
          await document.destroy();
          
          logger.info(`🗑️  Disposed document: ${document.document_id}`);
          disposedCount++;
          
        } catch (error) {
          logger.error(`❌ Error disposing document ${document.document_id}:`, error);
        }
      }
      
      logger.info(`✅ Document disposal completed: ${disposedCount} documents disposed`);
      
      return { disposed: disposedCount, total: documentsForDisposal.length };
      
    } catch (error) {
      logger.error('❌ Error in scheduled document disposal:', error);
      throw error;
    }
  }
  
  async generateRetentionReport(options = {}) {
    try {
      logger.info('📊 Generating document retention report');
      
      const { startDate, endDate, category, documentType } = options;
      
      const where = {};
      if (startDate || endDate) {
        where.created_at = {};
        if (startDate) where.created_at[Document.sequelize.Op.gte] = startDate;
        if (endDate) where.created_at[Document.sequelize.Op.lte] = endDate;
      }
      if (category) where.category = category;
      if (documentType) where.document_type = documentType;
      
      const [
        totalDocuments,
        documentsByCategory,
        documentsByType,
        expiringDocuments,
        documentsUnderLegalHold
      ] = await Promise.all([
        Document.count({ where }),
        Document.findAll({
          where,
          attributes: [
            'category',
            [Document.sequelize.fn('COUNT', '*'), 'count']
          ],
          group: 'category'
        }),
        Document.findAll({
          where,
          attributes: [
            'document_type',
            [Document.sequelize.fn('COUNT', '*'), 'count']
          ],
          group: 'document_type'
        }),
        Document.getExpiringDocuments(90), // Next 90 days
        Document.count({ where: { ...where, legal_hold: true } })
      ]);
      
      const report = {
        generatedAt: new Date(),
        parameters: options,
        summary: {
          totalDocuments,
          documentsUnderLegalHold,
          expiringInNext90Days: expiringDocuments.length
        },
        breakdown: {
          byCategory: documentsByCategory.map(d => ({
            category: d.category,
            count: parseInt(d.get('count'))
          })),
          byType: documentsByType.map(d => ({
            type: d.document_type,
            count: parseInt(d.get('count'))
          }))
        },
        expiringDocuments: expiringDocuments.map(d => ({
          documentId: d.document_id,
          title: d.title,
          retentionDate: d.retention_date,
          daysUntilExpiry: Math.ceil((new Date(d.retention_date) - new Date()) / (1000 * 60 * 60 * 24))
        }))
      };
      
      logger.info('✅ Retention report generated successfully');
      
      return report;
      
    } catch (error) {
      logger.error('❌ Error generating retention report:', error);
      throw error;
    }
  }
  
  // Encryption helper methods
  encryptBuffer(buffer) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.encryptionAlgorithm, this.encryptionKey, iv);
    
    let encrypted = cipher.update(buffer);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      encryptedData: encrypted,
      iv,
      authTag
    };
  }
  
  decryptBuffer(encryptedBuffer, { iv, authTag }) {
    const decipher = crypto.createDecipher(this.encryptionAlgorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  }
  
  // Helper methods
  generateDocumentId(metadata) {
    const prefix = metadata.documentType?.substring(0, 3).toUpperCase() || 'DOC';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }
  
  generateStoragePath(documentId, metadata) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const category = metadata.category?.toLowerCase() || 'general';
    
    return `compliance/${year}/${month}/${category}/${documentId}`;
  }
  
  generateTags(metadata) {
    const tags = [
      `Type=${metadata.documentType}`,
      `Category=${metadata.category}`,
      `RetentionYears=${metadata.retentionYears || 10}`,
      `CreatedBy=${metadata.createdBy}`
    ];
    
    if (metadata.beneficiaryId) {
      tags.push(`BeneficiaryId=${metadata.beneficiaryId}`);
    }
    
    if (metadata.employeeId) {
      tags.push(`EmployeeId=${metadata.employeeId}`);
    }
    
    return tags.join('&');
  }
}

module.exports = new DocumentRetentionService();