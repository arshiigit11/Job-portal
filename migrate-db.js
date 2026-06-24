const { MongoClient } = require('mongodb');

// Exact credentials provided
const LOCAL_URI = 'mongodb://127.0.0.1:27017/job_portal'; // Using 127.0.0.1 to avoid Node.js IPv6 localhost resolution issues
const ATLAS_URI = 'mongodb+srv://arshianam159_db_user:IRltjnBQkvA8VUNQ@arshi.xbxip82.mongodb.net/job_portal?appName=Arshi';

async function migrate() {
  console.log('🚀 Starting Database Migration...\n');

  let localClient;
  let atlasClient;

  try {
    // 1. Connect to Local DB
    console.log('⏳ Connecting to Local MongoDB...');
    localClient = await MongoClient.connect(LOCAL_URI);
    
    // Fallback logic just in case the local database was named 'job-portal' with a dash in earlier steps
    let localDb = localClient.db('job_portal');
    let collections = await localDb.listCollections().toArray();
    
    if (collections.length === 0) {
        console.log('⚠️ No collections found in "job_portal". Checking "job-portal" instead...');
        localDb = localClient.db('job-portal');
        collections = await localDb.listCollections().toArray();
    }

    console.log('✅ Connected to Local MongoDB.');

    // 2. Connect to Atlas DB
    console.log('⏳ Connecting to MongoDB Atlas...');
    atlasClient = await MongoClient.connect(ATLAS_URI);
    const atlasDb = atlasClient.db('job_portal');
    console.log('✅ Connected to MongoDB Atlas.\n');

    if (collections.length === 0) {
      console.log('⚠️ No collections found in the local database. Nothing to migrate.');
      return;
    }

    console.log(`📂 Found ${collections.length} collections locally to migrate:\n`);

    // 3. Iterate over each collection and copy data
    for (const colInfo of collections) {
      const collectionName = colInfo.name;
      
      // Skip system collections if any
      if (collectionName.startsWith('system.')) continue;

      console.log(`➡️  Processing collection: '${collectionName}'`);
      
      const localCollection = localDb.collection(collectionName);
      const atlasCollection = atlasDb.collection(collectionName);

      // Fetch all documents from local collection
      const docs = await localCollection.find({}).toArray();
      
      if (docs.length === 0) {
        console.log(`   - 0 documents found. Skipping.\n`);
        continue;
      }

      console.log(`   - Found ${docs.length} documents locally.`);

      try {
        // 4. Insert documents into Atlas
        // We use ordered: false so if one document fails (e.g. duplicate key), the rest still insert
        const result = await atlasCollection.insertMany(docs, { ordered: false });
        console.log(`   - ✅ Successfully inserted ${result.insertedCount} documents into Atlas.\n`);
      } catch (insertError) {
        // Handle partial insertions (e.g. if the document already exists in Atlas)
        if (insertError.writeErrors) {
          console.log(`   - ⚠️ Inserted ${insertError.result.nInserted} documents (some duplicates were skipped).\n`);
        } else {
          console.error(`   - ❌ Failed to insert into '${collectionName}':`, insertError.message);
        }
      }
    }

    console.log('🎉 Migration completed successfully!');

  } catch (error) {
    console.error('\n❌ Migration failed with error:');
    console.error(error);
  } finally {
    // 5. Safely close both connections
    console.log('\n🔌 Closing database connections...');
    if (localClient) await localClient.close();
    if (atlasClient) await atlasClient.close();
    console.log('✅ Connections closed.');
    process.exit(0);
  }
}

migrate();
