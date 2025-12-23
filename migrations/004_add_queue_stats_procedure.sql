-- Create the stored procedure for queue statistics
DELIMITER //
CREATE PROCEDURE `get_queue_stats`(
    IN p_branch_id VARCHAR(36),
    IN p_date DATE
)
BEGIN
    DECLARE v_today DATE;
    
    -- If no date provided, use today
    IF p_date IS NULL THEN
        SET v_today = CURDATE();
    ELSE
        SET v_today = p_date;
    END IF;
    
    -- Get stats for the specified date
    SELECT 
        -- Total tickets
        COUNT(*) AS total_tickets,
        
        -- Tickets by status
        SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting_tickets,
        SUM(CASE WHEN status = 'serving' THEN 1 ELSE 0 END) as serving_tickets,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed_tickets,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_tickets,
        
        -- Average wait time (in seconds)
        AVG(TIMESTAMPDIFF(SECOND, created_at, called_at)) as avg_wait_time_seconds,
        
        -- Average service time (in seconds)
        AVG(TIMESTAMPDIFF(SECOND, called_at, ended_at)) as avg_service_time_seconds,
        
        -- Peak hour
        HOUR(created_at) as peak_hour,
        
        -- Busiest service
        (SELECT name FROM services WHERE id = t.service_id GROUP BY service_id ORDER BY COUNT(*) DESC LIMIT 1) as busiest_service,
        
        -- Most active staff
        (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = t.served_by GROUP BY served_by ORDER BY COUNT(*) DESC LIMIT 1) as most_active_staff
        
    FROM tickets t
    WHERE 
        DATE(created_at) = v_today
        AND (p_branch_id IS NULL OR branch_id = p_branch_id);
    
END //
DELIMITER ;
