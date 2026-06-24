const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");
const sharp = require("sharp");
const axios = require("axios");
const FormData = require("form-data");
const SERVER_IP = "159.198.76.251";
const MEDIA_API_URL = `http://${SERVER_IP}:1000`;
const APP_URL = `http://${SERVER_IP}:2000`;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: 'travel-app-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database connection
const dbConfig = {
    host: '159.198.76.251',
    port: 3306,
    user: 'admin',
    password: 'Sawariyakadmin@123',
    database: 'goldenra_vihanga',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Initialize database table
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS travel_images (
                id INT AUTO_INCREMENT PRIMARY KEY,
                district_code VARCHAR(10) NOT NULL,
                place_name VARCHAR(255) NOT NULL,
                place_description TEXT NOT NULL,
                image_filename VARCHAR(255) NOT NULL,
                image_path VARCHAR(500) NOT NULL,
                uploaded_by VARCHAR(100) NOT NULL,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        connection.release();
        console.log("✅ Database initialized successfully");
        return true;
    } catch (error) {
        console.error("❌ Database initialization failed:", error.message);
        console.log("⚠️  Server will continue without database connectivity");
        return false;
    }
}

const TEMP_DIR = path.resolve("./temp");

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Multer config for multiple files
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TEMP_DIR),
    filename: (req, file, cb) =>
        cb(null, Date.now() + '_' + file.originalname)
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Only images allowed"));
    }
});

// Configure upload fields
const uploadFields = upload.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
    { name: 'image4', maxCount: 1 }
]);

async function uploadToMediaAPI(file) {
    try {
        const form = new FormData();

        form.append(
            "images",
            fs.createReadStream(file.path),
            file.originalname
        );

        const response = await axios.post(
            `${MEDIA_API_URL}/upload`,
            form,
            {
                headers: form.getHeaders()
            }
        );

        // Delete temp file
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }

        return response.data.files[0];

    } catch (error) {

        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }

        throw error;
    }
}

// Simple user database (in production, use a real database)
const users = [
    { username: 'admin', password: '$2b$10$26xAjXlHHgWUIsp1Czi5seCsfkWvjv6MvFn1PxdBZ7dkD9gBmTpEm' }, // password: 'admin123'
    { username: 'user', password: '$2b$10$QORbwvOxYfUrU8wl18xKC.4PQfj0jUTr0gcs0Vqy0kB2EDPc067Bq' }   // password: 'user123'
];

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        res.redirect('/login');
    }
}

// Root route - redirect to login
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Login endpoint
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = { username: user.username };
        res.redirect('/dashboard');
    } else {
        res.redirect('/login?error=invalid');
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out' });
        }
        res.redirect('/login');
    });
});

// Save place data endpoint (protected)
app.post("/save-place", requireAuth, uploadFields, async (req, res) => {
    try {
        const {
            placeName,
            district,
            placeDescription,
            category,
            location,
            latitude,
            longitude
        } = req.body;

        const uploadedBy = req.session.user.username;

        // Handle main image
        let mainImageFile = req.files['mainImage']
        ? req.files['mainImage'][0]
        : null;

        let mainImagePath = null;

        if (mainImageFile) {

            const mediaFile = await uploadToMediaAPI(mainImageFile);

            mainImagePath =
                `${MEDIA_API_URL}/images/${mediaFile.filename}`;
        }

        // Handle additional images - save as comma-separated string
        const additionalImages = [];

        for (let i = 1; i <= 4; i++) {

            const imgFile = req.files[`image${i}`]
                ? req.files[`image${i}`][0]
                : null;

            if (imgFile) {

                const mediaFile = await uploadToMediaAPI(imgFile);

                additionalImages.push(
                    `${MEDIA_API_URL}/images/${mediaFile.filename}`
                );
            }
        }
        const additionalImagesString = additionalImages.join(',');

        // Prepare data for PlacesData table
        const placeData = {
            PLName: placeName,
            PLDisCode: district,
            PLMImage: mainImagePath, // Save full path with filename
            PLCat: category,
            PLDesc: placeDescription,
            PLImages: additionalImagesString,
            PLLocation: location || null,
            PLFavStatus: 0, // Default favorite status
            PLCoLat: latitude ? parseFloat(latitude) : null,
            PLCoLng: longitude ? parseFloat(longitude) : null,
            PLActive: 0 // Default active status
        };

        // Insert into PlacesData table
        const connection = await pool.getConnection();
        const [result] = await connection.execute(
            `INSERT INTO PlacesData (
                PLName, PLDisCode, PLMImage, PLCat, PLDesc, PLImages,
                PLLocation, PLFavStatus, PLCoLat, PLCoLng, PLActive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                placeData.PLName,
                placeData.PLDisCode,
                placeData.PLMImage,
                placeData.PLCat,
                placeData.PLDesc,
                placeData.PLImages,
                placeData.PLLocation,
                placeData.PLFavStatus,
                placeData.PLCoLat,
                placeData.PLCoLng,
                placeData.PLActive
            ]
        );
        connection.release();

        res.json({
            message: "Place data saved successfully",
            placeId: result.insertId,
            placeName: placeName,
            mainImage: mainImagePath,
            additionalImages: additionalImages.length
        });

    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            message: "Failed to save place data",
            error: error.message
        });
    }
});

// API endpoint to get districts
app.get("/api/districts", async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT CODE, Description from District');
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch districts' });
    }
});

// API endpoint to get categories
app.get("/api/categories", async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT CODE, CatName from PlaceCategory');
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// API endpoint to get places data
app.get("/api/places", async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT p.ID, p.PLName, p.PLDisCode, p.PLMImage, p.PLCat, p.PLDesc,
                   p.PLImages, p.PLLocation, p.PLFavStatus, p.PLCoLat, p.PLCoLng,
                   CAST(p.PLActive AS UNSIGNED) as PLActive,
                   CAST(p.PLFavStatus AS UNSIGNED) as PLFavStatus,
                   d.Description as DistrictName
            FROM PlacesData p
            LEFT JOIN District d ON p.PLDisCode = d.CODE
            ORDER BY p.ID ASC
        `);
        connection.release();
        res.json({ places: rows });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch places data' });
    }
});

// API endpoint to get dashboard counts
app.get("/api/dashboard-counts", async (req, res) => {
    try {
        const connection = await pool.getConnection();

        // Get counts from all tables
        const [placesResult] = await connection.execute('SELECT COUNT(*) as count FROM PlacesData');
        const [plansResult] = await connection.execute('SELECT COUNT(*) as count FROM PlanHeader');
        const [reviewsResult] = await connection.execute('SELECT COUNT(*) as count FROM CusReview');
        const [customersResult] = await connection.execute('SELECT COUNT(*) as count FROM CustomerDetails');

        connection.release();

        res.json({
            places: placesResult[0].count || 0,
            plans: plansResult[0].count || 0,
            reviews: reviewsResult[0].count || 0,
            customers: customersResult[0].count || 0
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard counts' });
    }
});

// Serve dashboard (protected)
app.get("/dashboard", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Serve manage places (protected)
app.get("/manage-places", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "manage-places.html"));
});

// Serve customer reviews (protected)
app.get("/customer-reviews", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "customer-reviews.html"));
});

// API endpoint to get customer reviews data
app.get("/api/customer-reviews", async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT ID, CusName, Review, CAST(STATUS AS UNSIGNED) as STATUS, CusRating
            FROM CusReview
            ORDER BY ID DESC
        `);
        connection.release();
        res.json({ reviews: rows });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch customer reviews' });
    }
});

// API endpoint to update place status
app.post("/api/update-place-status", requireAuth, async (req, res) => {
    try {
        const { id, type, value } = req.body;

        if (!id || !type || value === undefined) {
            return res.status(400).json({ error: 'Missing required fields: id, type, value' });
        }

        let columnName;
        if (type === 'active') {
            columnName = 'PLActive';
        } else if (type === 'favourite') {
            columnName = 'PLFavStatus';
        } else {
            return res.status(400).json({ error: 'Invalid type. Must be "active" or "favourite"' });
        }

        const connection = await pool.getConnection();
        const [result] = await connection.execute(
            `UPDATE PlacesData SET ${columnName} = ? WHERE ID = ?`,
            [value, id]
        );
        connection.release();

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Place not found' });
        }

        res.json({
            message: 'Status updated successfully',
            id: id,
            type: type,
            value: value
        });

    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update place status' });
    }
});

// Serve upload interface (protected)
app.get("/upload", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "upload.html"));
});

// Start server
app.listen(2000, async () => {
    console.log(`🚀 Server running at IP ${APP_URL}`);
    await initializeDatabase();
});
